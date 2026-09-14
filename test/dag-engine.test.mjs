import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateGraph,
  getRunnableStages,
  markBlockedStages,
  executeDAG,
  NODE_STATUS,
} from '../lib/pipeline/dag-engine.js'

describe('DAG Engine', () => {
  it('detects cycles and throws error', () => {
    const cyclicStages = [
      { id: 'A', dependsOn: ['B'] },
      { id: 'B', dependsOn: ['C'] },
      { id: 'C', dependsOn: ['A'] },
    ]
    assert.throws(() => validateGraph(cyclicStages), /Circular dependency detected/)
  })

  it('detects self-dependency and non-existent dependencies', () => {
    assert.throws(
      () => validateGraph([{ id: 'A', dependsOn: ['A'] }]),
      /cannot depend on itself/
    )
    assert.throws(
      () => validateGraph([{ id: 'A', dependsOn: ['B'] }]),
      /depends on non-existent stage/
    )
  })

  it('validates a correct linear and branched DAG', () => {
    const validStages = [
      { id: 'spec', dependsOn: [] },
      { id: 'backend', dependsOn: ['spec'] },
      { id: 'ui', dependsOn: ['spec'] },
      { id: 'frontend', dependsOn: ['backend', 'ui'] },
    ]
    assert.equal(validateGraph(validStages), true)
  })

  it('executes independent stages in parallel and resolves dependencies', async () => {
    const order = []
    const stages = [
      { id: 'spec', dependsOn: [] },
      { id: 'backend', dependsOn: ['spec'] },
      { id: 'ui', dependsOn: ['spec'] },
      { id: 'frontend', dependsOn: ['backend', 'ui'] },
    ]

    const executor = async (stage) => {
      order.push(`start:${stage.id}`)
      await new Promise((r) => setTimeout(r, 20))
      order.push(`end:${stage.id}`)
      return `result-of-${stage.id}`
    }

    const result = await executeDAG({ stages, executor, concurrency: 4 })

    assert.equal(result.success, true)
    assert.equal(result.stateMap.spec.status, NODE_STATUS.COMPLETED)
    assert.equal(result.stateMap.backend.status, NODE_STATUS.COMPLETED)
    assert.equal(result.stateMap.ui.status, NODE_STATUS.COMPLETED)
    assert.equal(result.stateMap.frontend.status, NODE_STATUS.COMPLETED)

    // Spec must finish before backend and ui start
    const specEndIdx = order.indexOf('end:spec')
    const backendStartIdx = order.indexOf('start:backend')
    const uiStartIdx = order.indexOf('start:ui')
    const frontendStartIdx = order.indexOf('start:frontend')

    assert.ok(specEndIdx < backendStartIdx)
    assert.ok(specEndIdx < uiStartIdx)
    assert.ok(order.indexOf('end:backend') < frontendStartIdx)
    assert.ok(order.indexOf('end:ui') < frontendStartIdx)
  })

  it('propagates blockers when an upstream stage fails', async () => {
    const stages = [
      { id: 'stage1', dependsOn: [] },
      { id: 'stage2_failing', dependsOn: ['stage1'] },
      { id: 'stage3_blocked', dependsOn: ['stage2_failing'] },
      { id: 'stage4_independent', dependsOn: ['stage1'] },
    ]

    const blockedCalls = []
    const executor = async (stage) => {
      if (stage.id === 'stage2_failing') {
        throw new Error('Planned failure in stage 2')
      }
      return `ok-${stage.id}`
    }

    const result = await executeDAG({
      stages,
      executor,
      onNodeBlocked: (node) => blockedCalls.push(node.id),
    })

    assert.equal(result.success, false)
    assert.equal(result.stateMap.stage1.status, NODE_STATUS.COMPLETED)
    assert.equal(result.stateMap.stage2_failing.status, NODE_STATUS.FAILED)
    assert.equal(result.stateMap.stage3_blocked.status, NODE_STATUS.BLOCKED)
    assert.equal(result.stateMap.stage4_independent.status, NODE_STATUS.COMPLETED)
    assert.deepEqual(blockedCalls, ['stage3_blocked'])
  })
})

