import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { validateScenario } from '../lib/pipeline/scenarios.js'
import { decomposeTask } from '../lib/pipeline/decomposer.js'
import { syncDefaultPresets } from '../lib/pipeline/preset-sync.js'
import { registerOrchestratorRoutes } from '../lib/routes.js'

function createMockReq(bodyObj) {
  const json = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj)
  const ee = new EventEmitter()
  ee.method = 'POST'
  ee.headers = {
    host: '127.0.0.1:3000',
    'content-type': 'application/json',
  }
  ee.socket = { remoteAddress: '127.0.0.1' }
  ee.pause = () => {}
  process.nextTick(() => {
    ee.emit('data', Buffer.from(json))
    ee.emit('end')
  })
  return ee
}

function createMockRes() {
  let statusCode = 200
  let responseData = null
  return {
    setHeader: () => {},
    end: (data) => {
      if (data) {
        try { responseData = JSON.parse(data) } catch (_) { responseData = data }
      }
    },
    set statusCode(code) { statusCode = code },
    get statusCode() { return statusCode },
    get responseData() { return responseData },
  }
}

describe('Batch 7: Issue #132 - Runtime Scenario Validation', () => {
  it('validateScenario: passes for well-formed scenarios', () => {
    const valid = {
      id: 'test-scenario',
      name: 'Test Scenario',
      stages: [
        { id: 'stage-1', roleId: 'spec', dependsOn: [] },
        { id: 'stage-2', roleId: 'code', dependsOn: ['stage-1'] },
      ],
    }
    assert.equal(validateScenario(valid), true)
  })

  it('validateScenario: throws on non-objects or missing fields', () => {
    assert.throws(() => validateScenario(null), /Scenario must be an object/)
    assert.throws(() => validateScenario('string'), /Scenario must be an object/)
    assert.throws(() => validateScenario({ id: 'test' }), /stages array/)
    assert.throws(() => validateScenario({ stages: [] }), /Scenario must have an id/)
  })

  it('validateScenario: throws on cycles and empty stages', () => {
    assert.throws(
      () => validateScenario({ id: 'empty', stages: [] }),
      /must have at least one stage/
    )

    assert.throws(
      () =>
        validateScenario({
          id: 'cycle',
          stages: [
            { id: 'a', dependsOn: ['b'] },
            { id: 'b', dependsOn: ['a'] },
          ],
        }),
      /Circular dependency detected/
    )
  })

  it('decomposeTask: validates customScenarios at runtime and rejects cycles', () => {
    const brokenScenarios = {
      cyclic: {
        id: 'cyclic',
        stages: [
          { id: 'step-1', roleId: 'code', dependsOn: ['step-2'] },
          { id: 'step-2', roleId: 'code', dependsOn: ['step-1'] },
        ],
      },
    }

    assert.throws(
      () =>
        decomposeTask({
          taskTitle: 'Cyclic task',
          taskDescription: 'Testing invalid graph',
          scenarioId: 'cyclic',
          customScenarios: brokenScenarios,
        }),
      /Circular dependency detected/
    )
  })

  it('syncDefaultPresets: sanitizes corrupt scenarios without breaking sync', () => {
    const corruptedScenarios = {
      good_custom: {
        id: 'good_custom',
        name: 'Good Custom',
        stages: [{ id: 's1', roleId: 'code', dependsOn: [] }],
      },
      bad_cycle: {
        id: 'bad_cycle',
        name: 'Bad Cycle',
        stages: [
          { id: 'a', roleId: 'code', dependsOn: ['b'] },
          { id: 'b', roleId: 'code', dependsOn: ['a'] },
        ],
      },
      empty_custom: {
        id: 'empty_custom',
        name: 'Empty Draft',
        stages: [],
      },
    }

    let warningLogged = false
    const mockLogger = {
      warn: (msg) => {
        warningLogged = true
        assert.ok(msg.includes('[PresetSync] Discarding invalid existing scenario'))
      },
    }

    const res = syncDefaultPresets({
      currentScenarios: corruptedScenarios,
      logger: mockLogger,
    })

    assert.ok(res.scenarios.good_custom, 'Valid custom scenario must be preserved')
    assert.equal(res.scenarios.bad_cycle, undefined, 'Cyclic scenario must be discarded')
    assert.ok(res.scenarios.empty_custom, 'Empty draft scenario must be preserved')
    assert.ok(warningLogged, 'Logger.warn must be called for discarded scenarios')
  })

  it('HTTP Route: POST /config returns 400 Bad Request when receiving invalid scenario', async () => {
    const mockRoutes = new Map()
    const mockCtx = {
      effect: (fn) => fn(),
      webServer: {
        register: (route) => {
          mockRoutes.set(route.path, route.handler)
          return () => {}
        },
      },
    }

    registerOrchestratorRoutes(mockCtx, {
      store: {},
      runner: {},
      getConfig: () => ({}),
      updateConfig: async () => {},
      callLlm: async () => {},
    })

    const handler = mockRoutes.get('/dsh-agent-orchestrator/config')
    assert.ok(handler, 'Config route must be registered')

    const req = createMockReq({
      scenarios: {
        invalid_cyclic: {
          id: 'invalid_cyclic',
          stages: [
            { id: 'c1', dependsOn: ['c2'] },
            { id: 'c2', dependsOn: ['c1'] },
          ],
        },
      },
    })
    const res = createMockRes()

    await handler(req, res)
    assert.equal(res.statusCode, 400, 'Invalid scenario in POST /config must return 400')
    assert.ok(res.responseData?.error?.includes('Invalid scenario "invalid_cyclic"'))
  })
})
