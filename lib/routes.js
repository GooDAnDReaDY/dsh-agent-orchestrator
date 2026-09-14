/**
 * HTTP REST API Routes for DSH Multi-Agent Orchestrator.
 */

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
  const { store, runner, getConfig, updateConfig } = services

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

  // 2. Dispatch a new pipeline
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

  // 3. Pipeline details by ID
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-agent-orchestrator/pipeline/',
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

  // 4. Configuration (roles, scenarios)
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

  // 5. Available models query from ctx.llm
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-agent-orchestrator/models',
    handler: async (req, res) => {
      const models = []
      if (ctx.llm) {
        try {
          if (typeof ctx.llm.listAvailableModels === 'function') {
            const list = await ctx.llm.listAvailableModels()
            for (const item of (list || [])) {
              if (item?.provider && item?.id) {
                models.push({ provider: item.provider, model: item.id, label: `${item.provider}:${item.id}` })
              }
            }
          }
        } catch {}
      }
      // Fallback standard options if empty
      if (models.length === 0) {
        models.push(
          { provider: 'deepseek', model: 'deepseek-chat', label: 'deepseek:deepseek-chat' },
          { provider: 'deepseek', model: 'deepseek-reasoner', label: 'deepseek:deepseek-reasoner' },
          { provider: 'anthropic', model: 'claude-3-5-sonnet', label: 'anthropic:claude-3-5-sonnet' }
        )
      }
      jsonReply(res, { models })
    },
  }), 'dsh-agent-orchestrator: models route')
}

