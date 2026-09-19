import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { resolveToolIntersection, FailClosedAllowlistError } from '../lib/pipeline/intersection.js'
import { syncDefaultPresets } from '../lib/pipeline/preset-sync.js'
import { SnapshotManager } from '../lib/pipeline/snapshots.js'
import { renderOrchestratorRoster } from '../lib/pipeline/guidance.js'
import { getDefaultRoles, getDefaultScenarios } from '../lib/pipeline/scenarios.js'
import { apply, name } from '../lib/index.js'

test('Batch 6: Issue #104 - Fail-Closed Allowlist Guard', () => {
  // 1. If role requested tools, but intersection is empty, must throw FailClosedAllowlistError
  assert.throws(
    () => {
      resolveToolIntersection({
        roleTools: ['read', 'write', 'bash'],
        parentTools: ['some_completely_unrelated_tool'],
        roleId: 'code',
      })
    },
    (err) => {
      assert.equal(err.name, 'Error')
      assert.equal(err.code, 'ERR_FAIL_CLOSED_ALLOWLIST')
      assert.equal(err.isFailClosed, true)
      assert.match(err.message, /Fail-closed allowlist triggered/)
      return true
    }
  )

  // 2. If role requested tools and some match parent, does not throw and allows intersection
  const res = resolveToolIntersection({
    roleTools: ['read', 'write', 'bash'],
    parentTools: ['view_file', 'write_to_file'],
    roleId: 'code',
  })
  assert.ok(res.tools.includes('view_file'))
  assert.ok(res.tools.includes('write_to_file'))
  assert.equal(res.tools.length, 2)

  // 3. If role has no tools requested (pure reasoning), empty intersection is permitted
  const reasoningRes = resolveToolIntersection({
    roleTools: [],
    parentTools: ['view_file'],
    roleId: 'pure_reasoner',
    failLoud: false,
  })
  assert.equal(reasoningRes.tools.length, 0)
})

test('Batch 6: Issue #107 - Idempotent Self-Syncing Presets & Roles', () => {
  const existingRoles = [
    {
      id: 'architecture',
      name: 'Custom Architecture Lead',
      defaultModel: { provider: 'custom-ai', model: 'super-arch' },
      enabled: true,
    },
  ]
  const existingScenarios = {
    my_custom: {
      id: 'my_custom',
      title: 'My Custom DAG',
      stages: [],
    },
  }

  const res = syncDefaultPresets({
    currentRoles: existingRoles,
    currentScenarios: existingScenarios,
  })

  // Preserves existing customization
  const arch = res.roles.find((r) => r.id === 'architecture')
  assert.equal(arch.name, 'Custom Architecture Lead')
  assert.equal(arch.defaultModel.provider, 'custom-ai')

  // Backfills missing canonical roles (e.g. frontend, backend, qa_tests, docs)
  assert.ok(res.roles.some((r) => r.id === 'frontend'))
  assert.ok(res.roles.some((r) => r.id === 'backend'))
  assert.ok(res.roles.some((r) => r.id === 'qa_tests'))
  assert.ok(res.addedRolesCount > 0)

  // Preserves existing scenarios and adds default ones (hotfix, simple, medium, complex, enterprise)
  assert.ok(res.scenarios.my_custom)
  assert.ok(res.scenarios.hotfix)
  assert.ok(res.scenarios.complex)
  assert.ok(res.scenarios.enterprise)

  // Idempotency: second run adds 0 items
  const res2 = syncDefaultPresets({
    currentRoles: res.roles,
    currentScenarios: res.scenarios,
  })
  assert.equal(res2.addedRolesCount, 0)
  assert.equal(res2.addedScenariosCount, 0)
})

test('Batch 6: Issue #109 - Dispatch Snapshots & One-Click Save as Preset', () => {
  const tmpDir = path.join(os.tmpdir(), `dsh-snap-test-${Date.now()}`)
  try {
    const mgr = new SnapshotManager({ baseDir: tmpDir, maxSnapshots: 5 })

    // Create snapshot
    const snap1 = mgr.createSnapshot({
      id: 'snap-1',
      title: 'Hotfix Pipeline Run',
      scenarioId: 'hotfix',
      status: 'completed',
      stages: [{ id: 's1', name: 'Fix Bug', roleId: 'bugfix' }],
    })
    assert.equal(snap1.id, 'snap-1')

    // Read back
    const retrieved = mgr.getSnapshot('snap-1')
    assert.equal(retrieved.title, 'Hotfix Pipeline Run')

    // Save as preset
    const preset = mgr.saveAsPreset('snap-1', {
      name: 'Custom Hotfix Preset',
    })
    assert.equal(preset.name, 'Custom Hotfix Preset')
    assert.equal(preset.scenarioId, 'hotfix')
    assert.equal(preset.sourceSnapshotId, 'snap-1')
    assert.equal(preset.stages.length, 1)

    // Verify FIFO eviction on exceeding ceiling
    for (let i = 2; i <= 8; i++) {
      mgr.createSnapshot({
        id: `snap-${i}`,
        title: `Snapshot ${i}`,
        scenarioId: 'simple',
      })
    }
    const all = mgr.listSnapshots()
    assert.ok(all.length <= 5)
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch (_) {}
  }
})

test('Batch 6: Issue #101 - Enabled Roster Filter in Guidance', () => {
  const roles = [
    { id: 'role_a', displayName: 'Agent A', description: 'Active', enabled: true },
    { id: 'role_b', displayName: 'Agent B', description: 'Disabled', enabled: false },
    { id: 'role_c', displayName: 'Agent C', description: 'Default active' }, // enabled undefined -> active
  ]

  const output = renderOrchestratorRoster(roles, 'test_delegate')
  assert.ok(output.includes('role_a'))
  assert.ok(!output.includes('role_b')) // Disabled role filtered out
  assert.ok(output.includes('role_c'))
})

test('Batch 6: Issue #105 - Slash command /subagents and /roster registration', () => {
  const registeredCommands = new Map()
  const mockCtx = {
    inject(deps, fn) {
      if (deps.includes('commands')) {
        fn({
          commands: {
            register: (cmd) => {
              registeredCommands.set(cmd.name, cmd)
              return () => registeredCommands.delete(cmd.name)
            },
          },
        })
      }
      if (deps.includes('settings')) {
        fn({
          settings: {
            register: () => ({ get: () => null, set: async () => {} }),
          },
        })
      }
    },
    effect: () => () => {},
    on: () => () => {},
    webServer: { register: () => () => {} },
  }

  apply(mockCtx, {
    enabled: true,
  })

  assert.ok(registeredCommands.has('orchestrate'))
  assert.ok(registeredCommands.has('subagents'))
  assert.ok(registeredCommands.has('roster'))

  const subagentsCmd = registeredCommands.get('subagents')
  let followupCalled = false
  const fakeInvocation = {
    agent: {
      followup: (msg) => {
        followupCalled = true
        assert.ok(msg.content[0].text.includes('Multi-Agent Orchestrator: Agent Roster'))
        assert.ok(msg.content[0].text.includes('| Name | Role ID | Model | Status | maxTokens | Skills/Tools |'))
      },
    },
  }

  const result = subagentsCmd.handler(fakeInvocation)
  assert.ok(followupCalled)
})

test('Batch 6/7: Issue #139 - settings reachability, settings.plugins.tab and guard against dead settings.plugin.item', () => {
  const clientPath = path.resolve('lib/client.js')
  const clientContent = fs.readFileSync(clientPath, 'utf8')

  // Guard test: lib/client.js must not register into dead settings.plugin.item (Issue #139)
  assert.equal(clientContent.includes("'settings.plugin.item'"), false, "lib/client.js must not register 'settings.plugin.item'")
  assert.equal(clientContent.includes('"settings.plugin.item"'), false, 'lib/client.js must not register "settings.plugin.item"')

  // Must register into active DSH core slots (Issue #139)
  assert.ok(clientContent.includes("'settings.plugins.tab'"), 'Must register settings.plugins.tab')
  assert.ok(clientContent.includes("'plugins.item'"), 'Must register plugins.item')
  // settings.section is deliberately NOT registered: the owner does not want our
  // plugins in the root Settings list, and plugins.item is the seat the current core
  // renders as the plugin's own page with its configuration.
  assert.ok(!clientContent.includes("'settings.section',\n"), 'must not register into settings.section')
})
