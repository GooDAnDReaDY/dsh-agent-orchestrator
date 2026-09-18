import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import {
  SerializationGate,
  resolveScopedCwd,
} from '../lib/pipeline/concurrency-gate.js'
import {
  createDecisionTrace,
  sanitizeDecisionTrace,
  getTraceByteLength,
  MAX_TRACE_BYTES,
} from '../lib/pipeline/decision-trace.js'
import {
  SessionLifecycleManager,
} from '../lib/pipeline/session-lifecycle.js'
import { executeDirectDelegation } from '../lib/pipeline/delegation.js'

test('Batch 2: Concurrency Gate & Workspace Scoping', async (t) => {
  await t.test('SerializationGate: isolates parent sessions and enforces maxConcurrent', async () => {
    const gate = new SerializationGate(2)

    // Parent A acquires 2 slots
    const releaseA1 = await gate.acquire('parent-A', 'exec-1')
    assert.equal(gate.getActiveCount('parent-A'), 1)

    const releaseA2 = await gate.acquire('parent-A', 'exec-2')
    assert.equal(gate.getActiveCount('parent-A'), 2)

    // Parent A 3rd slot must be rejected (atomic capacity limit)
    await assert.rejects(
      () => gate.acquire('parent-A', 'exec-3'),
      /reached maximum concurrent subagents limit/
    )

    // Parent B can still acquire (isolated per parent session)
    const releaseB1 = await gate.acquire('parent-B', 'exec-b1')
    assert.equal(gate.getActiveCount('parent-B'), 1)

    // Release slot from A
    releaseA1()
    assert.equal(gate.getActiveCount('parent-A'), 1)

    // Now parent A can acquire a new slot
    const releaseA3 = await gate.acquire('parent-A', 'exec-3')
    assert.equal(gate.getActiveCount('parent-A'), 2)

    // Clean up
    releaseA2()
    releaseA3()
    releaseB1()
    assert.equal(gate.getActiveCount('parent-A'), 0)
    assert.equal(gate.getActiveCount('parent-B'), 0)
  })

  await t.test('resolveScopedCwd: safely resolves subdirectories and denies traversal escapes', () => {
    const baseDir = path.resolve('/tmp/test-project')

    // Empty or undefined defaults to baseDir
    assert.equal(resolveScopedCwd('', baseDir), baseDir)
    assert.equal(resolveScopedCwd(undefined, baseDir), baseDir)

    // Subdirectory path
    const validSub = resolveScopedCwd('packages/core', baseDir)
    assert.equal(validSub, 'packages/core')

    // Valid absolute subdirectory
    const validAbs = resolveScopedCwd(path.join(baseDir, 'src', 'components'), baseDir)
    assert.equal(validAbs, path.join(baseDir, 'src', 'components'))

    // Deny path traversal via relative ../
    assert.throws(
      () => resolveScopedCwd('../../etc/passwd', baseDir),
      /Access denied: requested cwd.*outside workspace boundary/
    )

    // Deny absolute escape
    const forbiddenAbs = path.resolve('/var/log')
    assert.throws(
      () => resolveScopedCwd(forbiddenAbs, baseDir),
      /Access denied: requested cwd.*outside workspace boundary/
    )
  })
})

test('Batch 2: Decision Trace Ledger (Issue #108)', async (t) => {
  await t.test('createDecisionTrace produces structured metadata <= 4096 bytes', () => {
    const trace = createDecisionTrace({
      executionId: 'exec-1234',
      roleId: 'backend',
      roleName: 'Backend Specialist',
      requestedModel: 'deepseek-chat',
      assignedModel: 'deepseek-chat',
      selectionReason: 'preset_match',
      toolSummary: { allowed: ['read', 'write'], strippedSecurity: ['run_code'] },
      droppedTools: ['run_code'],
      depth: 1,
      durationMs: 450,
      status: 'completed',
      rationale: 'Specialized API route refactoring',
    })

    assert.equal(trace.executionId, 'exec-1234')
    assert.equal(trace.roleId, 'backend')
    assert.equal(trace.model.assigned, 'deepseek-chat')
    assert.equal(trace.tools.allowedCount, 2)
    assert.ok(getTraceByteLength(trace) <= MAX_TRACE_BYTES)
  })

  await t.test('sanitizeDecisionTrace applies cascade truncation for oversized payloads', () => {
    const hugeLogs = Array.from({ length: 200 }, (_, i) => `Log entry ${i}: very long log message describing operations in detail...`)
    const hugeDropped = Array.from({ length: 50 }, (_, i) => `tool_${i}`)

    const hugeTrace = {
      executionId: 'exec-oversized',
      roleId: 'code',
      logs: hugeLogs,
      droppedTools: hugeDropped,
      rationale: 'A'.repeat(5000),
    }

    assert.ok(getTraceByteLength(hugeTrace) > MAX_TRACE_BYTES)

    const sanitized = sanitizeDecisionTrace(hugeTrace, MAX_TRACE_BYTES)
    const byteLen = getTraceByteLength(sanitized)

    assert.ok(byteLen <= MAX_TRACE_BYTES, `Byte length ${byteLen} exceeds limit ${MAX_TRACE_BYTES}`)
    assert.equal(sanitized.executionId, 'exec-oversized')
  })
})

test('Batch 2: Session Lifecycle Manager (Issue #56)', async (t) => {
  await t.test('registers, tracks, and archives completed sessions', async () => {
    let archivedId = null
    const mgr = new SessionLifecycleManager({
      gracePeriodMs: 20, // 20ms for fast testing
      reconcileIntervalMs: 0,
      onArchive: (id) => {
        archivedId = id
      },
    })

    mgr.register('session-1', { roleId: 'qa_tests' })
    assert.equal(mgr.getStats().active, 1)

    mgr.markCompleted('session-1', { stopReason: 'stop' })
    assert.equal(mgr.getStats().completed, 1)

    // Wait for grace period
    await new Promise((r) => setTimeout(r, 40))

    assert.equal(archivedId, 'session-1')
    assert.equal(mgr.getStats().total, 0)

    mgr.dispose()
  })

  await t.test('safely purges session from session_projcache.json file', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cache-'))
    const cacheFile = path.join(tmpDir, 'session_projcache.json')

    const initialData = [
      { id: 'sess-to-keep', name: 'Main Session' },
      { id: 'sess-to-delete', name: 'Subagent Session' },
    ]
    fs.writeFileSync(cacheFile, JSON.stringify(initialData, null, 2), 'utf-8')

    const mgr = new SessionLifecycleManager({
      projCachePath: cacheFile,
    })

    mgr.register('sess-to-delete')
    await mgr.archive('sess-to-delete')

    const remaining = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))
    assert.equal(remaining.length, 1)
    assert.equal(remaining[0].id, 'sess-to-keep')

    mgr.dispose()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})

test('Batch 2: Integration with executeDirectDelegation', async (t) => {
  const gate = new SerializationGate(1)
  const sessionLifecycle = new SessionLifecycleManager({ gracePeriodMs: 50 })

  const fakeLlm = async () => ({
    text: 'Task completed successfully',
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  })

  // 1. Valid delegation includes Decision Trace Ledger in presentationMeta
  const res = await executeDirectDelegation({
    roleId: 'backend',
    task: 'Write endpoint tests',
    callLlm: fakeLlm,
    serializationGate: gate,
    sessionLifecycle,
  })

  assert.equal(res.status, 'completed')
  assert.ok(res.decisionTrace, 'Missing decisionTrace')
  assert.ok(res.presentationMeta?.decisionTrace, 'Missing presentationMeta.decisionTrace')
  assert.equal(res.decisionTrace.roleId, 'backend')
  assert.ok(getTraceByteLength(res.decisionTrace) <= MAX_TRACE_BYTES)

  // 2. Traversal cwd is blocked
  await assert.rejects(
    () =>
      executeDirectDelegation({
        roleId: 'backend',
        task: 'Write tests',
        cwd: '../../outside',
        callLlm: fakeLlm,
        config: { baseDir: '/tmp/myproject' },
      }),
    /Access denied: requested cwd.*outside workspace boundary/
  )

  sessionLifecycle.dispose()
})
