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

import { detectOrchestratorIntent } from '../lib/pipeline/intent.js'

test('Batch 8: Issue #148 - detectOrchestratorIntent tags triggerKind (slash vs nl)', () => {
  const slashIntent = detectOrchestratorIntent('/orchestrate medium refactor store')
  assert.equal(slashIntent.isTrigger, true)
  assert.equal(slashIntent.triggerKind, 'slash')

  const orcIntent = detectOrchestratorIntent('/orc quick fix')
  assert.equal(orcIntent.isTrigger, true)
  assert.equal(orcIntent.triggerKind, 'slash')

  const ruIntent = detectOrchestratorIntent('сделай через оркестратор создать профиль')
  assert.equal(ruIntent.isTrigger, true)
  assert.equal(ruIntent.triggerKind, 'nl')

  const enIntent = detectOrchestratorIntent('orchestrate: fix payments')
  assert.equal(enIntent.isTrigger, true)
  assert.equal(enIntent.triggerKind, 'nl')
})

import { normalizeRoleId } from '../lib/pipeline/delegation.js'

test('Batch 8: Issue #149 - normalizeRoleId word boundary matching for short aliases', () => {
  // 1. False positive regression tests
  assert.notEqual(normalizeRoleId('build'), 'ui_design')
  assert.notEqual(normalizeRoleId('test-suite'), 'ui_design')
  assert.notEqual(normalizeRoleId('guidance'), 'ui_design')
  assert.notEqual(normalizeRoleId('precision'), 'devops')
  assert.notEqual(normalizeRoleId('отзвук'), 'spec')

  // 2. Legitimate matches
  assert.equal(normalizeRoleId('ui'), 'ui_design')
  assert.equal(normalizeRoleId('ui-design'), 'ui_design')
  assert.equal(normalizeRoleId('app_ui'), 'ui_design')
  assert.equal(normalizeRoleId('ci'), 'devops')
  assert.equal(normalizeRoleId('ci/cd'), 'devops')
  assert.equal(normalizeRoleId('тз'), 'spec')
  assert.equal(normalizeRoleId('тз на api'), 'spec')
})

import { SnapshotManager } from '../lib/pipeline/snapshots.js'
import fs from 'node:fs'

test('Batch 8: Issue #150 - store saveDebounced and SnapshotManager in-memory listing cache', async () => {
  // 1. Store saveDebounced
  const tmpStorePath = '/tmp/test-store-150-' + Date.now() + '.json'
  const store = new OrchestratorStore({ storagePath: tmpStorePath })
  store.recordPipeline({ pipelineId: 'pipe-debounce', taskTitle: 'Debounce Task' })
  store.updateStage('pipe-debounce', 's1', { status: 'running' })

  // Store output must be compact JSON without null, 2 indentation
  const raw = fs.readFileSync(tmpStorePath, 'utf8')
  assert.ok(!raw.includes('\n  "pipelines":'))

  // 2. Snapshot listing cache
  const tmpSnapDir = '/tmp/test-snaps-150-' + Date.now()
  const snapMgr = new SnapshotManager({ baseDir: tmpSnapDir })
  snapMgr.createSnapshot({ id: 'snap-1', title: 'Snap 1' })

  const list1 = snapMgr.listSnapshots()
  assert.equal(list1.length, 1)
  assert.equal(list1[0].id, 'snap-1')

  // Repeated list uses cache
  const list2 = snapMgr.listSnapshots()
  assert.equal(list2.length, 1)

  // Creating new snapshot invalidates cache
  snapMgr.createSnapshot({ id: 'snap-2', title: 'Snap 2' })
  const list3 = snapMgr.listSnapshots()
  assert.equal(list3.length, 2)
})

test('Batch 8: Issue #151 - OrchestratorQuickBar avoids activePipeline object identity dependency in useEffect', () => {
  const clientCode = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  // Must depend on hasActive or primitive boolean, not object activePipeline
  assert.ok(clientCode.includes('[hasActive, pollStatus]'))
  assert.ok(!clientCode.includes('}, [activePipeline, pollStatus]'))
})

import { formatCumulativeArtifacts } from '../lib/pipeline/cache-prefixer.js'

test('Batch 8: Issue #152 - deterministic sorting of upstream artifacts preserves KV-cache bytes', () => {
  const inputs1 = [
    { stageId: 'stage-B', roleId: 'code', output: 'Code output' },
    { stageId: 'stage-A', roleId: 'spec', output: 'Spec output' },
  ].sort((a, b) => a.stageId.localeCompare(b.stageId))

  const inputs2 = [
    { stageId: 'stage-A', roleId: 'spec', output: 'Spec output' },
    { stageId: 'stage-B', roleId: 'code', output: 'Code output' },
  ].sort((a, b) => a.stageId.localeCompare(b.stageId))

  const formatted1 = formatCumulativeArtifacts(inputs1)
  const formatted2 = formatCumulativeArtifacts(inputs2)

  assert.equal(formatted1, formatted2)
  assert.ok(formatted1.indexOf('stage-A') < formatted1.indexOf('stage-B'))
})

import { fetchModelCatalog } from '../lib/pipeline/model-selection.js'

test('Batch 8: Issue #153 - model-selection avoids hardcoded vendor models in defaults', async () => {
  const modelFile = fs.readFileSync(new URL('../lib/pipeline/model-selection.js', import.meta.url), 'utf8')
  assert.ok(!modelFile.includes('claude-3-5-sonnet'))

  // Default fallback pool when ctx has no live models
  const dummyCtx = {}
  const catalog = await fetchModelCatalog(dummyCtx)
  assert.ok(catalog.length >= 2)
  assert.ok(catalog.every((m) => m.provider === 'deepseek-official'))
})

import { registerOrchestratorRoutes } from '../lib/routes.js'

test('Batch 8: Issue #154 - read-only routes return 405 Method Not Allowed for non-GET verbs', async () => {
  const registered = new Map()
  const fakeCtx = {
    effect: (fn) => fn(),
    webServer: {
      register: (reg) => {
        registered.set(reg.path, reg.handler)
        return () => {}
      },
    },
  }

  registerOrchestratorRoutes(fakeCtx, {
    store: { getActivePipelines: () => [], getMetrics: () => ({}), getAllPipelines: () => [] },
    runner: {},
    getConfig: () => ({}),
    updateConfig: () => {},
    callLlm: () => {},
    snapshotManager: { listSnapshots: () => [] },
  })

  const createMockRes = () => {
    const res = {
      statusCode: 200,
      headers: {},
      body: null,
      setHeader: (k, v) => { res.headers[k] = v },
      end: (data) => {
        res.body = data ? JSON.parse(data) : null
      },
    }
    return res
  }

  // 1. POST /status -> 405
  const statusHandler = registered.get('/dsh-agent-orchestrator/status')
  assert.ok(statusHandler)
  const res1 = createMockRes()
  statusHandler({ method: 'POST', headers: {} }, res1)
  assert.equal(res1.statusCode, 405)
  assert.equal(res1.body.error, 'Method not allowed')

  // 2. DELETE /snapshots -> 405
  const snapshotsHandler = registered.get('/dsh-agent-orchestrator/snapshots')
  assert.ok(snapshotsHandler)
  const res2 = createMockRes()
  snapshotsHandler({ method: 'DELETE', headers: {} }, res2)
  assert.equal(res2.statusCode, 405)
  assert.equal(res2.body.error, 'Method not allowed')
})

test('Batch 8: Issue #155 - rejectUntrustedRequest protects read routes (/config, /pipeline, /snapshots)', async () => {
  const registered = new Map()
  const fakeCtx = {
    effect: (fn) => fn(),
    webServer: {
      register: (reg) => {
        registered.set(reg.path, reg.handler)
        return () => {}
      },
    },
  }

  registerOrchestratorRoutes(fakeCtx, {
    store: { getActivePipelines: () => [], getMetrics: () => ({}), getAllPipelines: () => [] },
    runner: {},
    getConfig: () => ({ secret: 'api-key-123' }),
    updateConfig: () => {},
    callLlm: () => {},
    snapshotManager: { listSnapshots: () => [] },
  })

  const createMockRes = () => {
    const res = {
      statusCode: 200,
      headers: {},
      body: null,
      setHeader: (k, v) => { res.headers[k] = v },
      end: (data) => {
        res.body = data ? JSON.parse(data) : null
      },
    }
    return res
  }

  const untrustedReq = {
    method: 'GET',
    url: '/dsh-agent-orchestrator/config',
    headers: {
      host: 'localhost:3080',
      origin: 'http://malicious-site.com',
    },
  }

  // 1. GET /config from untrusted origin -> 403 Forbidden
  const configHandler = registered.get('/dsh-agent-orchestrator/config')
  const res1 = createMockRes()
  await configHandler(untrustedReq, res1)
  assert.equal(res1.statusCode, 403)
  assert.equal(res1.body.error.code, 'forbidden')

  // 2. GET /snapshots from untrusted origin -> 403 Forbidden
  const snapshotsHandler = registered.get('/dsh-agent-orchestrator/snapshots')
  const res2 = createMockRes()
  snapshotsHandler({ ...untrustedReq, url: '/dsh-agent-orchestrator/snapshots' }, res2)
  assert.equal(res2.statusCode, 403)
  assert.equal(res2.body.error.code, 'forbidden')
})

test('Batch 8: Issue #156 - executeDAG respects AbortSignal and stops scheduling new stages', async () => {
  const controller = new AbortController()
  const executedStages = []

  const stages = [
    { id: 's1', name: 'Stage 1' },
    { id: 's2', name: 'Stage 2', dependsOn: ['s1'] },
  ]

  const dagPromise = executeDAG({
    stages,
    signal: controller.signal,
    executor: async (s) => {
      executedStages.push(s.id)
      controller.abort()
      return 'done'
    },
    concurrency: 1,
  })

  const result = await dagPromise
  assert.equal(result.success, false)
  assert.equal(result.cancelled, true)
  assert.equal(executedStages.length, 1)
  assert.equal(executedStages[0], 's1')
  assert.equal(result.stateMap.s2.status, 'skipped')
})
