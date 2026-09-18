import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import {
  validateModelCandidate,
  resolveSmartModel,
  inferTaskComplexityTier,
  TASK_TIERS,
  ModelValidationError,
  resolveSpecialistModel,
} from '../lib/pipeline/model-selection.js'
import {
  isMaxTokensTruncated,
  runWithMaxTokensWatchdog,
  MaxTokensLoopError,
} from '../lib/pipeline/token-watchdog.js'
import {
  SessionLifecycleManager,
} from '../lib/pipeline/session-lifecycle.js'

test('Batch 3: Fail-Fast Model Validation & Candidate Shortlist (Issue #82)', async (t) => {
  const fakeRegistry = [
    {
      id: 'deepseek-official',
      models: ['deepseek-chat', 'deepseek-reasoner'],
    },
    {
      id: 'openai',
      models: ['gpt-4o', 'gpt-4o-mini'],
    },
  ]

  await t.test('accepts exact and case-insensitive matches', () => {
    const res1 = validateModelCandidate({
      provider: 'deepseek-official',
      model: 'deepseek-chat',
      registryProviders: fakeRegistry,
    })
    assert.equal(res1.valid, true)
    assert.equal(res1.resolvedModel, 'deepseek-chat')

    const res2 = validateModelCandidate({
      provider: 'deepseek-official',
      model: 'DEEPSEEK-REASONER',
      registryProviders: fakeRegistry,
    })
    assert.equal(res2.valid, true)
    assert.equal(res2.resolvedModel, 'deepseek-reasoner')
  })

  await t.test('returns candidateShortlist on mismatched model', () => {
    const res = validateModelCandidate({
      provider: 'deepseek-official',
      model: 'deepseek-v3-nonexistent',
      registryProviders: fakeRegistry,
      failFast: false,
    })
    assert.equal(res.valid, false)
    assert.deepEqual(res.candidateShortlist, ['deepseek-chat', 'deepseek-reasoner'])
    assert.equal(res.suggestedModel, 'deepseek-chat')
    assert.ok(res.warning.includes('Available candidates'))
  })

  await t.test('failFast: true throws ModelValidationError with candidate list', () => {
    assert.throws(
      () =>
        validateModelCandidate({
          provider: 'deepseek-official',
          model: 'mistyped-model',
          registryProviders: fakeRegistry,
          failFast: true,
        }),
      (err) => {
        assert.ok(err instanceof ModelValidationError)
        assert.deepEqual(err.candidateShortlist, ['deepseek-chat', 'deepseek-reasoner'])
        return true
      }
    )
  })
})

test('Batch 3: Smart Model Routing (Issue #48)', async (t) => {
  await t.test('inferTaskComplexityTier detects light vs reasoning tasks correctly', () => {
    assert.equal(inferTaskComplexityTier('architecture', 'Create system spec'), TASK_TIERS.REASONING)
    assert.equal(inferTaskComplexityTier('security_audit', 'Check routes'), TASK_TIERS.REASONING)
    assert.equal(inferTaskComplexityTier('code', 'Audit security vulnerabilities in auth'), TASK_TIERS.REASONING)

    assert.equal(inferTaskComplexityTier('docs', 'Update readme'), TASK_TIERS.LIGHT)
    assert.equal(inferTaskComplexityTier('code', 'Format and lint codebase files'), TASK_TIERS.LIGHT)

    assert.equal(inferTaskComplexityTier('code', 'Implement users route handler'), TASK_TIERS.BALANCED)
  })

  await t.test('resolveSmartModel routes based on complexity and respects allowedProviders', () => {
    const baseModel = { provider: 'deepseek-official', model: 'deepseek-chat' }

    // Disabled -> returns base model
    const disabled = resolveSmartModel({
      roleId: 'architecture',
      task: 'System design',
      baseModel,
      enabled: false,
    })
    assert.equal(disabled.model, 'deepseek-chat')
    assert.equal(disabled.reason, 'smart_routing_disabled')

    // Enabled reasoning task -> deepseek-reasoner
    const reasoning = resolveSmartModel({
      roleId: 'architecture',
      task: 'Design deadlock-free pipeline',
      baseModel,
      enabled: true,
    })
    assert.equal(reasoning.model, 'deepseek-reasoner')
    assert.equal(reasoning.tier, 'reasoning')

    // Whitelist check: provider rejected
    const whitelisted = resolveSmartModel({
      roleId: 'architecture',
      task: 'System design',
      baseModel,
      enabled: true,
      allowedProviders: ['anthropic'], // deepseek not allowed
    })
    assert.equal(whitelisted.provider, 'deepseek-official')
    assert.equal(whitelisted.tier, 'fallback')
    assert.ok(whitelisted.reason.includes('not_in_allowedProviders'))
  })
})

test('Batch 3: Deterministic max-tokens Watchdog (Issue #75)', async (t) => {
  await t.test('isMaxTokensTruncated identifies truncation kinds correctly', () => {
    assert.equal(isMaxTokensTruncated('max-tokens'), true)
    assert.equal(isMaxTokensTruncated('max_tokens'), true)
    assert.equal(isMaxTokensTruncated('length'), true)
    assert.equal(isMaxTokensTruncated({ kind: 'max-tokens' }), true)
    assert.equal(isMaxTokensTruncated('completed'), false)
    assert.equal(isMaxTokensTruncated('stop'), false)
  })

  await t.test('normal execution completes without continuation', async () => {
    const res = await runWithMaxTokensWatchdog({
      executeTurn: async () => ({ output: 'Full response', stopReason: 'stop' }),
    })
    assert.equal(res.output, 'Full response')
    assert.equal(res.continuationCount, 0)
    assert.equal(res.wasTruncated, false)
  })

  await t.test('triggers single continuation turn and merges output when truncated', async () => {
    let turnCount = 0
    let flushed = false

    const res = await runWithMaxTokensWatchdog({
      flushCheckpoint: async () => {
        flushed = true
      },
      executeTurn: async (count) => {
        turnCount++
        if (count === 0) {
          return { output: 'Part 1 of code...', stopReason: 'max_tokens' }
        }
        return { output: 'Part 2 completing the code.', stopReason: 'completed' }
      },
    })

    assert.equal(turnCount, 2)
    assert.equal(flushed, true)
    assert.equal(res.continuationCount, 1)
    assert.equal(res.wasTruncated, true)
    assert.ok(res.output.includes('Part 1'))
    assert.ok(res.output.includes('Part 2'))
  })

  await t.test('halts with MaxTokensLoopError on repeated truncation (Continue-Once Guarantee)', async () => {
    await assert.rejects(
      () =>
        runWithMaxTokensWatchdog({
          executeTurn: async () => ({ output: 'Truncated chunk...', stopReason: 'max_tokens' }),
        }),
      (err) => {
        assert.ok(err instanceof MaxTokensLoopError)
        assert.ok(err.message.includes('Continue-Once Guarantee') || err.message.includes('truncated by token limit twice'))
        return true
      }
    )
  })
})

test('Batch 3: Capacity Recycling & Two-Phase Reversible Archive (Issues #67, #57)', async (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lifecycle-test-'))
  const archiveDir = path.join(tmpBase, 'archive')

  await t.test('Capacity Recycling evicts oldest completed one-shot subagent (Issue #67)', async () => {
    const mgr = new SessionLifecycleManager({
      maxCapacity: 2, // Low cap for test
      archiveDir,
      gracePeriodMs: 10000,
    })

    // Register 2 sessions
    mgr.register('sess-1', { mode: 'one-shot' })
    mgr.markCompleted('sess-1') // Completed first

    mgr.register('sess-2', { mode: 'one-shot', isPinned: true }) // Pinned

    // Register 3rd session -> exceeds capacity of 2
    mgr.register('sess-3', { mode: 'one-shot' })

    // Sess-1 should have been evicted/archived because sess-2 is pinned
    assert.ok(!mgr.sessions.has('sess-1'))
    assert.ok(mgr.sessions.has('sess-2'))
    assert.ok(mgr.sessions.has('sess-3'))

    mgr.dispose()
  })

  await t.test('Two-Phase Reversible Archive and Restore (Issue #57)', async () => {
    let deletedId = null
    const mgr = new SessionLifecycleManager({
      archiveDir,
      gracePeriodMs: 50,
      retentionMs: 40, // 40ms retention for testing
      onDelete: (id) => {
        deletedId = id
      },
    })

    mgr.register('session-reversible', { mode: 'one-shot', task: 'Analyze log' })

    // Phase 1: archive
    await mgr.archive('session-reversible')

    const metaFile = path.join(archiveDir, 'session-reversible', 'meta.json')
    assert.ok(fs.existsSync(metaFile), 'Archive meta.json should exist in Phase 1')

    // Test restore before retention expires
    const restored = mgr.restore('session-reversible')
    assert.equal(restored, true)
    assert.equal(mgr.sessions.get('session-reversible')?.status, 'active')
    assert.ok(!fs.existsSync(metaFile), 'Archive directory should be cleaned on restore')

    // Archive again and let retention physically delete
    await mgr.archive('session-reversible')
    assert.ok(fs.existsSync(metaFile))

    // Wait for retention timer to physically delete (Phase 2)
    await new Promise((r) => setTimeout(r, 60))

    assert.equal(deletedId, 'session-reversible')
    assert.ok(!fs.existsSync(metaFile), 'Meta file should be physically deleted in Phase 2')

    mgr.dispose()
  })

  fs.rmSync(tmpBase, { recursive: true, force: true })
})
