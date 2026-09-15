import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveToolIntersection,
  FORBIDDEN_SECURITY_TOOLS,
  FORBIDDEN_DELEGATION_TOOLS,
} from '../lib/pipeline/intersection.js'

test('resolveToolIntersection: correctly computes parent ∩ role intersection', () => {
  const parentTools = ['read_file', 'write_file', 'list_dir', 'grep_search']
  const roleTools = ['read_file', 'write_file', 'git_commit']

  const result = resolveToolIntersection({ parentTools, roleTools })

  // git_commit is not in parentTools, so it should be denied
  assert.deepEqual(result.tools, ['read_file', 'write_file'])
  assert.deepEqual(result.diff.allowed, ['read_file', 'write_file'])
  assert.deepEqual(result.diff.denied, ['git_commit'])
  assert.deepEqual(result.diff.strippedSecurity, [])
})

test('resolveToolIntersection: strictly strips run_code and security forbidden tools', () => {
  const parentTools = ['read_file', 'run_code', 'code_exec', 'grep_search']
  const roleTools = ['read_file', 'run_code', 'grep_search']

  const result = resolveToolIntersection({ parentTools, roleTools })

  assert.ok(!result.tools.includes('run_code'))
  assert.ok(!result.tools.includes('code_exec'))
  assert.deepEqual(result.tools, ['read_file', 'grep_search'])
  assert.ok(result.diff.strippedSecurity.includes('run_code'))
})

test('resolveToolIntersection: strips delegation tools (anti-redelegation shield)', () => {
  const parentTools = [
    'read_file',
    'agent_run',
    'orchestrator_delegate_specialist',
    'delegate',
  ]
  const roleTools = ['read_file', 'agent_run', 'delegate']

  const result = resolveToolIntersection({ parentTools, roleTools })

  assert.deepEqual(result.tools, ['read_file'])
  assert.ok(result.diff.strippedSecurity.includes('agent_run'))
  assert.ok(result.diff.strippedSecurity.includes('delegate'))
})

test('resolveToolIntersection: fail-loud throws when requested tools result in empty set', () => {
  const parentTools = ['read_file']
  const roleTools = ['run_code'] // only run_code requested, which gets stripped

  assert.throws(
    () => {
      resolveToolIntersection({ parentTools, roleTools, roleId: 'untrusted', failLoud: true })
    },
    (err) => {
      return (
        err instanceof Error &&
        err.message.includes('SecurityViolation') &&
        err.message.includes('untrusted')
      )
    }
  )
})

test('resolveToolIntersection: handles tool objects with { name } schemas', () => {
  const parentTools = [{ name: 'read_file' }, { name: 'grep_search' }]
  const roleTools = [{ name: 'read_file' }, { name: 'network_fetch' }]

  const result = resolveToolIntersection({ parentTools, roleTools })
  assert.deepEqual(result.tools, ['read_file'])
  assert.deepEqual(result.diff.denied, ['network_fetch'])
})

test('resolveToolIntersection: supports custom denyList', () => {
  const parentTools = ['read_file', 'write_file', 'delete_file']
  const denyList = ['delete_file']

  const result = resolveToolIntersection({ parentTools, denyList })
  assert.deepEqual(result.tools, ['read_file', 'write_file'])
  assert.deepEqual(result.diff.denied, ['delete_file'])
})
