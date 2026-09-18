/**
 * HTTP REST API Routes for DSH Multi-Agent Orchestrator.
 *
 * Implements:
 * - Fail-closed origin/host/loopback check on state mutating routes (/dispatch, /delegate, /cancel, /config, /snapshots/save-as-preset) (Issue #113)
 * - Strict body payload limit (1MB max, 413 Payload Too Large on overflow) (Issue #113)
 * - Safe read-only /status route (no mutations, public metrics only) (Issue #113)
 * - Snapshots listing & One-Click Save as Preset (Issue #109)
 */

import { readModelSelection, fetchModelCatalog } from './pipeline/model-selection.js'
import { executeDirectDelegation } from './pipeline/delegation.js'
import { rejectUntrustedRequest, parseBoundedJsonBody } from './http-guard.js'
import { SnapshotManager } from './pipeline/snapshots.js'

function jsonReply(res, data, status = 200) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

export function registerOrchestratorRoutes(ctx, services) {
  const { store, runner, getConfig, updateConfig, callLlm, snapshotManager = new SnapshotManager() } = services

  // 1. Status & Global Metrics (Read-only status overview)
  // Conscious architectural choice (Issue #113): Public read-only endpoint returning non-sensitive metrics
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-agent-orchestrator/status',
    handler: (req, res) => {
      jsonReply(res, {
        activePipelines: store.getActivePipelines(),
        metrics: store.getMetrics(),
        recentPipelines: store.getAllPipelines().slice(0, 10),
      })
    },
  }), 'dsh-agent-orchestrator: status route')

  // 2. Dispatch a new pipeline (multi-stage DAG) - Guarded (Issue #113)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-agent-orchestrator/dispatch',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        return jsonReply(res, { error: 'Method not allowed' }, 405)
      }
      if (rejectUntrustedRequest(req, res)) return

      let body
      try {
        body = await parseBoundedJsonBody(req)
      } catch (err) {
        return jsonReply(res, { error: err.message }, err.statusCode || 400)
      }

      try {
        const pipeline = await runner.startPipeline({
          taskTitle: body.taskTitle || body.title || 'Manual Pipeline Run',
          taskDescription: body.taskDescription || body.description || body.prompt || '',
          scenarioId: body.scenarioId || 'auto',
          taskId: body.taskId, // optional linked kanban task
        })
        jsonReply(res, { success: true, pipeline })
      } catch (err) {
        jsonReply(res, { error: err?.message || String(err) }, 400)
      }
    },
  }), 'dsh-agent-orchestrator: dispatch route')

  // 3. Direct Specialist Delegation (single subagent) - Guarded (Issue #113)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-agent-orchestrator/delegate',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        return jsonReply(res, { error: 'Method not allowed' }, 405)
      }
      if (rejectUntrustedRequest(req, res)) return

      let body
      try {
        body = await parseBoundedJsonBody(req)
      } catch (err) {
        return jsonReply(res, { error: err.message }, err.statusCode || 400)
      }

      if (!body.task) {
        return jsonReply(res, { error: 'Missing required field: task' }, 400)
      }

      try {
        const selection = readModelSelection(ctx)
        const result = await executeDirectDelegation({
          roleId: body.roleId || 'architecture',
          task: body.task,
          context: body.context || '',
          roles: getConfig().roles,
          config: getConfig(),
          callLlm,
          allowedRoutes: selection.allowedRoutes,
        })
        jsonReply(res, { success: true, deliverable: result })
      } catch (err) {
        jsonReply(res, { error: err?.message || String(err) }, 500)
      }
    },
  }), 'dsh-agent-orchestrator: direct delegate route')

  // 4. Pipeline details by ID
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-agent-orchestrator/pipeline',
    handler: (req, res) => {
      const parts = req.url.split('?')[0].split('/')
      const pipelineId = parts[parts.length - 1]
      const pipeline = store.getPipeline(pipelineId)
      if (!pipeline) {
        return jsonReply(res, { error: 'Pipeline not found' }, 404)
      }
      jsonReply(res, { pipeline })
    },
  }), 'dsh-agent-orchestrator: pipeline detail route')

  // 4b. Cancel a running pipeline - Guarded (Issue #113)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-agent-orchestrator/cancel',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        return jsonReply(res, { error: 'Method not allowed' }, 405)
      }
      if (rejectUntrustedRequest(req, res)) return

      let body
      try {
        body = await parseBoundedJsonBody(req)
      } catch (err) {
        return jsonReply(res, { error: err.message }, err.statusCode || 400)
      }

      const pipelineId = body.pipelineId
      const p = store.getPipeline(pipelineId)
      if (p && (p.status === 'running' || p.status === 'pending')) {
        store.updatePipeline(pipelineId, {
          status: 'failed',
          completedAt: Date.now(),
          error: 'Cancelled by user',
        })
        return jsonReply(res, { success: true })
      }
      jsonReply(res, { success: false, error: 'Pipeline not running or not found' }, 404)
    },
  }), 'dsh-agent-orchestrator: cancel route')

  // 5. Configuration (roles, scenarios, kanbanSync) - Guarded (Issue #113)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-agent-orchestrator/config',
    handler: async (req, res) => {
      if (req.method === 'POST') {
        if (rejectUntrustedRequest(req, res)) return
        let body
        try {
          body = await parseBoundedJsonBody(req)
        } catch (err) {
          return jsonReply(res, { error: err.message }, err.statusCode || 400)
        }
        await updateConfig(body)
        return jsonReply(res, { success: true, config: getConfig() })
      }
      jsonReply(res, { config: getConfig() })
    },
  }), 'dsh-agent-orchestrator: config route')

  // 6. Available models query with allowedModels integration
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-agent-orchestrator/models',
    handler: async (req, res) => {
      const selection = readModelSelection(ctx)
      const catalog = await fetchModelCatalog(ctx, {
        allowedRoutes: selection.allowedRoutes,
      })

      jsonReply(res, {
        models: catalog,
        authorizedConstraint: Boolean(selection.allowedRoutes && selection.allowedRoutes.length > 0),
      })
    },
  }), 'dsh-agent-orchestrator: models route')

  // 6b. Live Model & Subagent Catalog query (Issue #76)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-agent-orchestrator/catalog/models',
    handler: async (req, res) => {
      try {
        const urlObj = new URL(req.url, 'http://localhost')
        const provider = urlObj.searchParams.get('provider') || undefined
        const capability = urlObj.searchParams.get('capability') || undefined

        const catalog = await fetchModelCatalog(ctx, { provider, capability })
        jsonReply(res, {
          total: catalog.length,
          catalog,
        })
      } catch (err) {
        jsonReply(res, { error: err?.message || String(err) }, 500)
      }
    },
  }), 'dsh-agent-orchestrator: catalog models route')

  // 7. Dispatch Snapshots Listing (Issue #109)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-agent-orchestrator/snapshots',
    handler: (req, res) => {
      try {
        const snapshots = snapshotManager.listSnapshots()
        jsonReply(res, { snapshots, total: snapshots.length })
      } catch (err) {
        jsonReply(res, { error: err?.message || String(err) }, 500)
      }
    },
  }), 'dsh-agent-orchestrator: snapshots list route')

  // 8. One-Click Save as Preset (Issue #109) - Guarded (Issue #113)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-agent-orchestrator/snapshots/save-as-preset',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        return jsonReply(res, { error: 'Method not allowed' }, 405)
      }
      if (rejectUntrustedRequest(req, res)) return

      let body
      try {
        body = await parseBoundedJsonBody(req)
      } catch (err) {
        return jsonReply(res, { error: err.message }, err.statusCode || 400)
      }

      const { snapshotId, name, description } = body || {}
      if (!snapshotId) {
        return jsonReply(res, { error: 'Missing required field: snapshotId' }, 400)
      }

      try {
        const preset = snapshotManager.saveAsPreset(snapshotId, { name, description })

        // Idempotently persist to configured scenarios
        const currentScenarios = getConfig().scenarios || {}
        currentScenarios[preset.id] = preset
        await updateConfig({ scenarios: currentScenarios })

        jsonReply(res, { success: true, preset })
      } catch (err) {
        jsonReply(res, { error: err?.message || String(err) }, 500)
      }
    },
  }), 'dsh-agent-orchestrator: save-as-preset route')
}
