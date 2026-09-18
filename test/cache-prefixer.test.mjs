import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStaticBaseAnchor,
  buildSharedTaskAnchor,
  formatCumulativeArtifacts,
  assembleAgentMessages,
  extractCacheMetrics,
  MIN_CACHE_ANCHOR_TOKENS,
} from '../lib/pipeline/cache-prefixer.js'

describe('Prompt Caching & Prefix Optimizer', () => {
  it('exports MIN_CACHE_ANCHOR_TOKENS with value 1024', () => {
    assert.equal(MIN_CACHE_ANCHOR_TOKENS, 1024)
  })

  it('generates a stable, byte-identical base anchor (>= 1024 tokens worth of characters)', () => {
    const anchor1 = buildStaticBaseAnchor({ projectType: 'dsh-plugin' })
    const anchor2 = buildStaticBaseAnchor({ projectType: 'dsh-plugin' })

    assert.equal(anchor1, anchor2)
    // Approximate token count: 1 token ~ 4 chars for English/Markdown.
    // Anchor must exceed MIN_CACHE_ANCHOR_TOKENS (1024 tokens -> ~4096 chars).
    const estimatedTokens = Math.floor(anchor1.length / 4)
    assert.ok(
      estimatedTokens >= MIN_CACHE_ANCHOR_TOKENS,
      `Expected base anchor to have >= ${MIN_CACHE_ANCHOR_TOKENS} tokens, got estimated ${estimatedTokens} (${anchor1.length} chars)`
    )
  })

  it('preserves unbroken prefix across sequential stages (Cumulative Append-Only)', () => {
    const baseAnchor = buildStaticBaseAnchor()
    const taskAnchor = buildSharedTaskAnchor({ id: 'task-1', title: 'Test Feature' })

    // Stage 1: Spec
    const msgStage1 = assembleAgentMessages({
      baseAnchor,
      taskAnchor,
      cumulativeArtifacts: '',
      agentRole: { id: 'spec', name: 'Spec Analyst' },
      currentStage: { id: 's1', name: 'Spec Stage' },
    })

    // Stage 2: Architecture (receives artifact from Stage 1)
    const stage1Output = '### Functional Spec:\nRequirement A and B.'
    const cumulativeArt1 = formatCumulativeArtifacts([
      { stageId: 's1', roleId: 'spec', output: stage1Output },
    ])

    const msgStage2 = assembleAgentMessages({
      baseAnchor,
      taskAnchor,
      cumulativeArtifacts: cumulativeArt1,
      agentRole: { id: 'architecture', name: 'Architect' },
      currentStage: { id: 's2', name: 'Architecture Stage' },
    })

    // The system prefix of Stage 2 must start with the EXACT system prefix of Stage 1
    assert.ok(
      msgStage2[0].content.startsWith(msgStage1[0].content),
      'Stage 2 system prompt must start with the exact prefix of Stage 1 for 100% KV cache reuse!'
    )
  })

  it('correctly parses prompt cache telemetry and computes savings', () => {
    const usage = {
      prompt_tokens: 4000,
      completion_tokens: 500,
      prompt_cache_hit_tokens: 3600,
      prompt_cache_miss_tokens: 400,
    }

    const metrics = extractCacheMetrics(usage)

    assert.equal(metrics.promptTokens, 4000)
    assert.equal(metrics.completionTokens, 500)
    assert.equal(metrics.cacheHitTokens, 3600)
    assert.equal(metrics.cacheMissTokens, 400)
    assert.equal(metrics.hitRatio, 0.9)
    assert.equal(metrics.estimatedSavingsPct, 81) // 0.9 * 90%
  })

  it('handles zero or missing cache hit tokens without crashing', () => {
    const usage = { inputTokens: 1000, outputTokens: 200 }
    const metrics = extractCacheMetrics(usage)

    assert.equal(metrics.promptTokens, 1000)
    assert.equal(metrics.cacheHitTokens, 0)
    assert.equal(metrics.hitRatio, 0)
    assert.equal(metrics.estimatedSavingsPct, 0)
  })
})
