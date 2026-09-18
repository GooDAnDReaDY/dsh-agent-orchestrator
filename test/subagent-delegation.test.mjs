import test from 'node:test'
import assert from 'node:assert/strict'
import {
  executeDirectDelegation,
  HARD_MAX_DEPTH,
  NESTED_DELEGATION_GUARD_MESSAGE,
  DELEGATION_DEPTH_LIMIT_MESSAGE,
} from '../lib/pipeline/delegation.js'
import { getDefaultRoles } from '../lib/pipeline/scenarios.js'

test('executeDirectDelegation: starts native one-shot subagent with approval=never and toolFilter', async () => {
  const roles = getDefaultRoles()
  let capturedStart = null

  const mockRun = {
    id: 'child-run-456',
    result: Promise.resolve({
      stopReason: 'completed',
      output: [{ type: 'text', text: 'Architecture analysis complete: Event-driven bus recommended.' }],
    }),
    dispose: async () => {},
  }

  const mockSubagents = {
    getProvider: (name) => (name === 'spawn' ? { name: 'spawn' } : null),
    start: async (provider, request) => {
      capturedStart = { provider, request }
      return mockRun
    },
  }

  const result = await executeDirectDelegation({
    roleId: 'architecture',
    task: 'Evaluate event bus architecture',
    mode: 'one-shot',
    roles,
    subagents: mockSubagents,
    parentTools: ['view_file', 'write_to_file', 'grep_search', 'run_code', 'agent_run'], // dangerous & delegation tools in parent
    parentSessionId: 'parent-session-123',
    config: {},
  })

  assert.equal(result.kind, 'foreground')
  assert.equal(result.childSessionId, 'child-run-456')
  assert.equal(result.status, 'completed')
  assert.match(result.output, /Architecture analysis complete/)

  // Verify native request params
  assert.ok(capturedStart !== null)
  assert.equal(capturedStart.provider, 'spawn')
  assert.equal(capturedStart.request.parent, 'parent-session-123')
  assert.equal(capturedStart.request.approval, 'never') // Issue #110
  assert.equal(capturedStart.request.maxDepth, 1) // Issue #102: Leaf Expert Bound
  assert.ok(capturedStart.request.persona.length > 0)

  // Verify Tool Intersection: run_code stripped, agent_run stripped, view_file kept (Issue #2 & #103)
  assert.ok(capturedStart.request.toolFilter.allow.includes('view_file'))
  assert.ok(!capturedStart.request.toolFilter.allow.includes('run_code'))
  assert.ok(!capturedStart.request.toolFilter.allow.includes('agent_run'))
  assert.ok(result.toolDiff.strippedSecurity.includes('run_code'))
  assert.ok(result.toolDiff.strippedSecurity.includes('agent_run'))

  // Verify droppedTools diagnostics (Issue #111)
  assert.ok(Array.isArray(result.droppedTools))
  assert.ok(result.droppedTools.some((d) => d.tool === 'run_code' && d.reason === 'security'))
  assert.ok(result.droppedTools.some((d) => d.tool === 'agent_run' && d.reason === 'anti-redelegation'))
})

test('executeDirectDelegation: starts continuable child session with mode=continuable', async () => {
  const roles = getDefaultRoles()
  let capturedContinuable = null

  const mockSubagents = {
    getProvider: (name) => (name === 'spawn' ? { name: 'spawn' } : null),
    startContinuable: async (options) => {
      capturedContinuable = options
      return { childId: 'continuable-child-789' }
    },
  }

  const result = await executeDirectDelegation({
    roleId: 'frontend',
    task: 'Develop reactive timeline component',
    mode: 'continuable',
    cwd: 'packages/ui',
    roles,
    subagents: mockSubagents,
    parentTools: ['view_file', 'write_to_file'],
    parentSessionId: 'parent-session-123',
  })

  assert.equal(result.kind, 'continuable')
  assert.equal(result.childSessionId, 'continuable-child-789')
  assert.equal(result.status, 'running')

  assert.ok(capturedContinuable !== null)
  assert.equal(capturedContinuable.request.cwd, 'packages/ui')
  assert.equal(capturedContinuable.request.approval, 'never')
  assert.equal(capturedContinuable.request.maxDepth, 1) // Issue #102
})

test('executeDirectDelegation: fail-loud blocks execution before calling subagents if intersection is empty', async () => {
  const roles = getDefaultRoles()
  let subagentsCalled = false

  const mockSubagents = {
    getProvider: () => ({}),
    start: async () => {
      subagentsCalled = true
      return {}
    },
  }

  await assert.rejects(
    async () => {
      await executeDirectDelegation({
        roleId: 'frontend',
        task: 'Do UI work',
        roles,
        subagents: mockSubagents,
        parentTools: ['some_unrelated_custom_tool'], // parent lacks all frontend tools
        parentSessionId: 'parent-123',
      })
    },
    {
      name: 'Error',
      message: /SecurityViolation: Tool intersection for role "frontend" is empty/,
    }
  )

  assert.equal(subagentsCalled, false)
})

test('executeDirectDelegation: blocks nested delegation when disableNestedDelegation=true (Issue #19)', async () => {
  const roles = getDefaultRoles()
  let subagentsCalled = false

  const mockSubagents = {
    getProvider: () => ({}),
    start: async () => {
      subagentsCalled = true
      return {}
    },
  }

  // Attempt delegation from inside child session (currentDepth = 1)
  await assert.rejects(
    async () => {
      await executeDirectDelegation({
        roleId: 'code',
        task: 'Nested delegation task',
        roles,
        subagents: mockSubagents,
        parentTools: ['view_file', 'write_to_file'],
        currentDepth: 1,
        config: { disableNestedDelegation: true },
      })
    },
    (err) => {
      assert.match(err.message, /Nested delegation is disabled by plugin policy/)
      return true
    }
  )

  assert.equal(subagentsCalled, false)
})

test('executeDirectDelegation: blocks delegation exceeding HARD_MAX_DEPTH = 3 (Anti-Matryoshka Guard, Issue #19)', async () => {
  const roles = getDefaultRoles()
  let subagentsCalled = false

  const mockSubagents = {
    getProvider: () => ({}),
    start: async () => {
      subagentsCalled = true
      return {}
    },
  }

  // Attempt delegation at 4th level (currentDepth = 3)
  await assert.rejects(
    async () => {
      await executeDirectDelegation({
        roleId: 'qa_tests',
        task: 'Level 4 task',
        roles,
        subagents: mockSubagents,
        parentTools: ['view_file'],
        currentDepth: 3,
        config: { disableNestedDelegation: false },
      })
    },
    (err) => {
      assert.match(err.message, /Delegation depth limit reached/)
      assert.match(err.message, /Anti-Matryoshka Guard/)
      return true
    }
  )

  assert.equal(subagentsCalled, false)
})
