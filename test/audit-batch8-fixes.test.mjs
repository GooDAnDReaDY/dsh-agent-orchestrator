import test from 'node:test'
import assert from 'node:assert/strict'
import { executeDAG } from '../lib/pipeline/dag-engine.js'

test('Batch 8: Issue #146 - DAG result property alignment (stateMap and success)', async () => {
  const stages = [
    { id: 's1', name: 'Stage 1', roleId: 'arch', roleName: 'Architect' },
    { id: 's2', name: 'Stage 2', roleId: 'code', roleName: 'Coder', dependsOn: ['s1'] },
  ]

  const dagResult = await executeDAG({
    stages,
    executor: async (stage) => ({ output: 'Result from ' + stage.id }),
    concurrency: 2,
  })

  // 1. Must return success, stateMap, artifacts, durationMs
  assert.equal(typeof dagResult.success, 'boolean')
  assert.equal(dagResult.success, true)
  assert.ok(dagResult.stateMap)
  assert.ok(dagResult.stateMap.s1)
  assert.ok(dagResult.stateMap.s2)

  // 2. Checklist extraction should use stateMap[s.id].status without throwing
  const checklist = stages.map((s) => ({
    title: s.name + ' (' + s.roleName + ')',
    completed: dagResult?.stateMap?.[s.id]?.status === 'completed',
  }))

  assert.equal(checklist.length, 2)
  assert.equal(checklist[0].completed, true)
  assert.equal(checklist[1].completed, true)

  // 3. Status mapping for snapshots should use dagResult.success
  const snapshotStatus = dagResult?.success ? 'completed' : 'failed'
  assert.equal(snapshotStatus, 'completed')
})

import { OrchestratorStore } from '../lib/store.js'

test('Batch 8: Issue #147 - store.recordCompletion aggregates cache metrics and counts', () => {
  const store = new OrchestratorStore({ storagePath: '/tmp/test-store-147-' + Date.now() + '.json' })
  store.recordPipeline({ pipelineId: 'pipe-1', taskTitle: 'Test 1' })

  store.recordCompletion('pipe-1', {
    success: true,
    durationMs: 1500,
    stateMap: {
      stageA: {
        status: 'completed',
        metrics: { promptTokens: 1000, cacheHitTokens: 800, cacheMissTokens: 200 },
      },
      stageB: {
        status: 'completed',
        metrics: { promptTokens: 500, cacheHitTokens: 400, cacheMissTokens: 100 },
      },
    },
    artifacts: { stageA: 'Artifact A' },
  })

  const p = store.getPipeline('pipe-1')
  assert.equal(p.status, 'completed')
  assert.equal(p.durationMs, 1500)
  assert.equal(store.globalMetrics.completedPipelines, 1)
  assert.equal(store.globalMetrics.failedPipelines, 0)
  assert.equal(store.globalMetrics.totalPromptTokens, 1500)
  assert.equal(store.globalMetrics.totalCacheHitTokens, 1200)
  assert.equal(store.globalMetrics.totalCacheMissTokens, 300)
  assert.equal(store.globalMetrics.overallHitRatio, 0.8)
})
