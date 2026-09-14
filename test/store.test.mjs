import test from 'node:test'
import assert from 'node:assert/strict'
import { OrchestratorStore } from '../lib/store.js'

test('OrchestratorStore: records and updates pipeline with function and object', () => {
  const store = new OrchestratorStore({ storageDir: '/tmp' })
  const pipe = {
    pipelineId: 'pipe-test-123',
    taskTitle: 'Test Store Pipeline',
    status: 'running',
    stages: [{ id: 'stage_1', name: 'Stage 1', status: 'pending' }],
    stateMap: {},
  }

  store.recordPipeline(pipe)
  assert.equal(store.getPipeline('pipe-test-123').status, 'running')

  // Update with object
  store.updatePipeline('pipe-test-123', { status: 'completed', durationMs: 150 })
  assert.equal(store.getPipeline('pipe-test-123').status, 'completed')
  assert.equal(store.getPipeline('pipe-test-123').durationMs, 150)

  // Update stage with object
  store.updateStage('pipe-test-123', 'stage_1', { status: 'completed', output: 'Done' })
  assert.equal(store.getPipeline('pipe-test-123').stateMap['stage_1'].status, 'completed')
  assert.equal(store.getPipeline('pipe-test-123').stages[0].status, 'completed')

  // Append stage log
  store.appendStageLog('pipe-test-123', 'stage_1', 'chunk 1')
  store.appendStageLog('pipe-test-123', 'stage_1', ' chunk 2')
  assert.equal(store.getPipeline('pipe-test-123').stageLogs['stage_1'], 'chunk 1 chunk 2')
})
