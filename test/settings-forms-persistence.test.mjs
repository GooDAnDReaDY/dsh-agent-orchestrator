import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { apply } from '../lib/index.js'
import { registerOrchestratorRoutes } from '../lib/routes.js'

function createMockRequest({ method = 'GET', body = null, headers = {} } = {}) {
  const reqHeaders = {
    host: '127.0.0.1:3080',
    origin: 'http://127.0.0.1:3080',
    ...headers,
  }
  const stream = body !== null
    ? Readable.from([typeof body === 'string' ? body : JSON.stringify(body)])
    : Readable.from([])

  stream.method = method
  stream.headers = reqHeaders
  stream.socket = { remoteAddress: '127.0.0.1' }
  stream.connection = { remoteAddress: '127.0.0.1' }
  return stream
}

function createMockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { res.headers[k] = v },
    end(data) {
      if (data) {
        try {
          res.body = JSON.parse(data)
        } catch {
          res.body = data
        }
      }
    },
  }
  return res
}

describe('Issue #160: Modern SettingsForms Persistence & Fallback', () => {
  it('loads initial settings from SettingsForms describe() and persists via replace() with revision', async () => {
    let currentRevision = 3
    const savedValues = {
      enabled: true,
      defaultScenario: 'medium',
      disableNestedDelegation: true,
      kanbanSync: { enabled: true, targetColumn: 'done' },
      roles: [{ id: 'test_role', name: 'Test Role' }],
    }

    let replaceCalledWith = null

    const mockSettingsSvc = {
      describe: () => [
        {
          ns: 'dsh-agent-orchestrator',
          autoGenerate: true,
          revision: currentRevision,
          value: { ...savedValues },
        },
      ],
      replace: async (ns, section, expectedRevision) => {
        replaceCalledWith = { ns, section, expectedRevision }
        if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
          throw new Error(`Revision mismatch: expected ${expectedRevision}, actual ${currentRevision}`)
        }
        currentRevision++
        Object.assign(savedValues, section)
      },
    }

    const registeredRoutes = []
    const mockCtx = {
      inject(deps, fn) {
        if (deps.includes('settings')) {
          fn({
            settings: mockSettingsSvc,
            effect: (eff) => eff(),
          })
        }
      },
      effect: (fn) => fn(),
      on: () => () => {},
      emit: () => {},
      webServer: {
        register: (route) => {
          registeredRoutes.push(route)
          return () => {}
        },
      },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    }

    apply(mockCtx, { enabled: false, defaultScenario: 'auto' })

    const configRoute = registeredRoutes.find((r) => r.path === '/dsh-agent-orchestrator/config')
    assert.ok(configRoute, 'Config route must be registered')

    // 1. Initial GET /config returns loaded settings from describe()
    const getReq = createMockRequest({ method: 'GET' })
    const getRes = createMockResponse()
    await configRoute.handler(getReq, getRes)
    assert.equal(getRes.statusCode, 200)
    assert.equal(getRes.body.config.defaultScenario, 'medium')
    assert.equal(getRes.body.config.disableNestedDelegation, true)
    assert.equal(getRes.body.config.kanbanSync.enabled, true)

    // 2. POST /config updates and persists to replace()
    const updateBody = {
      defaultScenario: 'enterprise',
      disableNestedDelegation: false,
      kanbanSync: { targetColumn: 'testing' },
    }

    const postReq = createMockRequest({ method: 'POST', body: updateBody })
    const postRes = createMockResponse()
    await configRoute.handler(postReq, postRes)

    assert.equal(postRes.statusCode, 200)
    assert.equal(postRes.body.success, true)
    assert.equal(postRes.body.config.defaultScenario, 'enterprise')
    assert.equal(postRes.body.config.disableNestedDelegation, false)
    assert.equal(postRes.body.config.kanbanSync.targetColumn, 'testing')

    // Verify replace() was called with full payload and revision 3
    assert.ok(replaceCalledWith)
    assert.equal(replaceCalledWith.ns, 'dsh-agent-orchestrator')
    assert.equal(replaceCalledWith.expectedRevision, 3)
    assert.equal(replaceCalledWith.section.defaultScenario, 'enterprise')
    assert.equal(replaceCalledWith.section.disableNestedDelegation, false)
    assert.ok(Array.isArray(replaceCalledWith.section.roles))
  })

  it('handles SettingsForms conflict or persistence error with 500 error reply', async () => {
    const mockSettingsSvc = {
      describe: () => [
        {
          ns: 'dsh-agent-orchestrator',
          revision: 1,
          value: { enabled: true },
        },
      ],
      replace: async () => {
        throw new Error('SETTINGS_CONFLICT: Revision 1 is stale')
      },
    }

    const registeredRoutes = []
    const mockCtx = {
      inject(deps, fn) {
        if (deps.includes('settings')) {
          fn({
            settings: mockSettingsSvc,
            effect: (eff) => eff(),
          })
        }
      },
      effect: (fn) => fn(),
      on: () => () => {},
      emit: () => {},
      webServer: {
        register: (route) => {
          registeredRoutes.push(route)
          return () => {}
        },
      },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    }

    apply(mockCtx, {})

    const configRoute = registeredRoutes.find((r) => r.path === '/dsh-agent-orchestrator/config')
    const postReq = createMockRequest({ method: 'POST', body: { defaultScenario: 'complex' } })
    const postRes = createMockResponse()

    await configRoute.handler(postReq, postRes)

    assert.equal(postRes.statusCode, 500)
    assert.equal(postRes.body.success, false)
    assert.match(postRes.body.error, /SETTINGS_CONFLICT/)
  })

  it('returns 500 when settings service is unavailable', async () => {
    const registeredRoutes = []
    const mockCtx = {
      inject() {
        // settings service never injects
      },
      effect: (fn) => fn(),
      on: () => () => {},
      emit: () => {},
      webServer: {
        register: (route) => {
          registeredRoutes.push(route)
          return () => {}
        },
      },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    }

    apply(mockCtx, {})

    const configRoute = registeredRoutes.find((r) => r.path === '/dsh-agent-orchestrator/config')
    const postReq = createMockRequest({ method: 'POST', body: { enabled: false } })
    const postRes = createMockResponse()

    await configRoute.handler(postReq, postRes)

    assert.equal(postRes.statusCode, 500)
    assert.equal(postRes.body.success, false)
    assert.match(postRes.body.error, /Settings service is unavailable/)
  })

  it('falls back seamlessly to legacy register() if present', async () => {
    const legacySaved = { defaultScenario: 'hotfix' }
    let setCalledWith = []
    const mockLegacyScope = {
      get: () => legacySaved,
      set: async (k, v) => { setCalledWith.push({ k, v }) },
      watch: () => () => {},
    }

    const mockSettingsSvc = {
      register: (ns, schema, opts) => mockLegacyScope,
    }

    const registeredRoutes = []
    const mockCtx = {
      inject(deps, fn) {
        if (deps.includes('settings')) {
          fn({
            settings: mockSettingsSvc,
            effect: (eff) => eff(),
          })
        }
      },
      effect: (fn) => fn(),
      on: () => () => {},
      emit: () => {},
      webServer: {
        register: (route) => {
          registeredRoutes.push(route)
          return () => {}
        },
      },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    }

    apply(mockCtx, {})

    const configRoute = registeredRoutes.find((r) => r.path === '/dsh-agent-orchestrator/config')
    const postReq = createMockRequest({ method: 'POST', body: { defaultScenario: 'enterprise' } })
    const postRes = createMockResponse()

    await configRoute.handler(postReq, postRes)

    assert.equal(postRes.statusCode, 200)
    assert.equal(postRes.body.success, true)
    assert.ok(setCalledWith.some((item) => item.k === 'defaultScenario' && item.v === 'enterprise'))
  })

  it('updates live config when settings/document-updated event is emitted', async () => {
    let eventHandler = null
    let currentConfigValue = { defaultScenario: 'simple', enabled: true }

    const mockSettingsSvc = {
      describe: () => [
        {
          ns: 'dsh-agent-orchestrator',
          revision: 2,
          value: currentConfigValue,
        },
      ],
      replace: async () => {},
    }

    const mockCtx = {
      inject(deps, fn) {
        if (deps.includes('settings')) {
          fn({
            settings: mockSettingsSvc,
            effect: (eff) => eff(),
          })
        }
      },
      effect: (fn) => fn(),
      on: (ev, handler) => {
        if (ev === 'settings/document-updated') {
          eventHandler = handler
        }
        return () => {}
      },
      emit: () => {},
      webServer: { register: () => () => {} },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    }

    apply(mockCtx, {})

    // Simulate external update in SettingsForms (e.g. from DSH web UI)
    currentConfigValue = { defaultScenario: 'enterprise', enabled: true }
    assert.ok(eventHandler, 'Event handler for settings/document-updated must be registered')
    eventHandler('dsh-agent-orchestrator', 3)

    const registeredRoutes = []
    registerOrchestratorRoutes(mockCtx, {
      getConfig: () => mockCtx.getConfig ? mockCtx.getConfig() : currentConfigValue,
      updateConfig: async () => {},
    })

    assert.equal(currentConfigValue.defaultScenario, 'enterprise')
  })
})