/**
 * HTTP REST API Routes for DSH Multi-Agent Orchestrator.
 */

import { readModelSelection } from './pipeline/model-selection.js'
import { executeDirectDelegation } from './pipeline/delegation.js'

function jsonReply(res, data, status = 200) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function parseJsonBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

export function registerOrchestratorRoutes(ctx, services) {
  const { store, runner, getConfig, updateConfig, callLlm } = services

  // 1. Status & Global Metrics
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

  // 2. Dispatch a new pipeline (multi-stage DAG)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-agent-orchestrator/dispatch',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        return jsonReply(res, { error: 'Method not allowed' }, 405)
      }
      const body = await parseJsonBody(req)
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

  // 3. Direct Specialist Delegation (single subagent)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-agent-orchestrator/delegate',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        return jsonReply(res, { error: 'Method not allowed' }, 405)
      }
      const body = await parseJsonBody(req)
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

  // 4b. Cancel a running pipeline
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-agent-orchestrator/cancel',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        return jsonReply(res, { error: 'Method not allowed' }, 405)
      }
      const body = await parseJsonBody(req)
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

  // 5. Configuration (roles, scenarios, kanbanSync)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-agent-orchestrator/config',
    handler: async (req, res) => {
      if (req.method === 'POST') {
        const body = await parseJsonBody(req)
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
      const models = []
      const selection = readModelSelection(ctx)

      if (selection.sectionPresent && selection.allowedRoutes && selection.allowedRoutes.length > 0) {
        for (const item of selection.allowedRoutes) {
          models.push({
            provider: item.provider,
            model: item.model,
            label: `${item.provider}:${item.model} (authorized)`,
            authorized: true,
          })
        }
      }

      if (ctx.llm) {
        try {
          if (typeof ctx.llm.listAvailableModels === 'function') {
            const list = await ctx.llm.listAvailableModels()
            for (const item of (list || [])) {
              if (item?.provider && item?.id) {
                const already = models.find((m) => m.provider === item.provider && m.model === item.id)
                if (!already) {
                  models.push({
                    provider: item.provider,
                    model: item.id,
                    label: `${item.provider}:${item.id}`,
                    authorized: !selection.allowedRoutes,
                  })
                }
              }
            }
          }
        } catch {}
      }

      // Fallback standard options if empty
      if (models.length === 0) {
        models.push(
          { provider: 'deepseek', model: 'deepseek-chat', label: 'deepseek:deepseek-chat', authorized: true },
          { provider: 'deepseek', model: 'deepseek-reasoner', label: 'deepseek:deepseek-reasoner', authorized: true },
          { provider: 'anthropic', model: 'claude-3-5-sonnet', label: 'anthropic:claude-3-5-sonnet', authorized: true }
        )
      }

      jsonReply(res, {
        models,
        authorizedConstraint: Boolean(selection.allowedRoutes && selection.allowedRoutes.length > 0),
      })
    },
  }), 'dsh-agent-orchestrator: models route')
}
