/**
 * DeepSeek Harness Multi-Agent Orchestrator Plugin (Host Half)
 *
 * Scoped Name: @goodandready/dsh-agent-orchestrator
 * Short ID: dsh-agent-orchestrator
 */

import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { getDefaultRoles, getDefaultScenarios } from './pipeline/scenarios.js'
import { decomposeTask } from './pipeline/decomposer.js'
import { executeDAG } from './pipeline/dag-engine.js'
import { executeStageWorker } from './pipeline/worker-pool.js'
import { OrchestratorStore } from './store.js'
import { KanbanBridge } from './integrations/kanban-bridge.js'
import { registerOrchestratorRoutes } from './routes.js'

export const name = '@goodandready/dsh-agent-orchestrator'
export const inject = ['settings', 'webServer', 'llm', 'tools']

export const Config = z.object({
  enabled: z.boolean().default(true).description('Enable Multi-Agent Orchestrator pipeline dispatcher'),
  defaultScenario: z.string().default('auto').description('Default complexity scenario (auto, hotfix, simple, medium, complex, enterprise)'),
})

export function apply(ctx, config) {
  const NS = 'dsh-agent-orchestrator'
  let currentSettings = {
    ...config,
    roles: getDefaultRoles(),
    scenarios: getDefaultScenarios(),
  }

  // Register settings scope
  ctx.inject(['settings'], (sctx) => {
    try {
      const scope = sctx.settings.register(NS, Config, { base: config })
      if (scope) {
        const saved = scope.get()
        if (saved) {
          currentSettings = {
            ...currentSettings,
            ...saved,
            roles: saved.roles || getDefaultRoles(),
            scenarios: saved.scenarios || getDefaultScenarios(),
          }
        }
      }
    } catch (e) {
      console.warn('[dsh-agent-orchestrator] Settings register warning:', e?.message || e)
    }
  })

  const getConfig = () => currentSettings
  const updateConfig = async (partial) => {
    currentSettings = { ...currentSettings, ...partial }
  }

  const store = new OrchestratorStore()
  const kanbanBridge = new KanbanBridge({
    port: ctx.webServer?.port || 3080,
    fetchImpl: globalThis.fetch,
  })

  /**
   * Unified LLM caller wrapping ctx.llm.prepareCall().stream()
   */
  const callLlm = async ({ provider, model, messages, temperature = 0.3, maxTokens = 4096, onStreamDelta }) => {
    if (!ctx.llm) {
      throw new Error('ctx.llm is not available in cordis context')
    }

    let prep
    try {
      prep = await ctx.llm.prepareCall({ provider, model })
    } catch {
      if (typeof ctx.llm.prepareCall === 'function') {
        prep = await ctx.llm.prepareCall(provider, model)
      } else {
        throw new Error(`Failed to prepareCall for ${provider}:${model}`)
      }
    }

    if (!prep || typeof prep.stream !== 'function') {
      throw new Error(`LLM provider/model ${provider}:${model} does not support streaming`)
    }

    const abortCtrl = new AbortController()
    const timeoutId = setTimeout(() => abortCtrl.abort(new Error('LLM call timeout (120s)')), 120000)
    timeoutId.unref?.()

    try {
      const stream = prep.stream({
        messages,
        temperature,
        maxTokens,
        signal: abortCtrl.signal,
      })

      let fullText = ''
      let usageInfo = null

      for await (const chunk of stream) {
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          fullText += chunk.text
          if (typeof onStreamDelta === 'function') {
            onStreamDelta(chunk.text)
          }
        } else if (chunk.type === 'block-end' && chunk.block?.text) {
          if (!fullText) fullText = chunk.block.text
        } else if (chunk.type === 'usage' && chunk.usage) {
          usageInfo = chunk.usage
        }
      }

      clearTimeout(timeoutId)
      return {
        text: fullText,
        content: fullText,
        usage: usageInfo || {
          prompt_tokens: Math.round(JSON.stringify(messages).length / 4),
          completion_tokens: Math.round(fullText.length / 4),
        },
      }
    } catch (err) {
      clearTimeout(timeoutId)
      throw err
    }
  }

  /**
   * Runner object to start, execute, and monitor pipelines
   */
  const runner = {
    async startPipeline({ taskTitle, taskDescription, scenarioId, taskId }) {
      const cfg = getConfig()
      const plan = decomposeTask({
        taskTitle,
        taskDescription,
        scenarioId: scenarioId || cfg.defaultScenario || 'auto',
        customScenarios: cfg.scenarios,
        customRoles: cfg.roles,
      })

      const pipelineData = {
        ...plan,
        taskId: taskId || null,
        status: 'running',
        startedAt: Date.now(),
        completedAt: null,
        durationMs: 0,
        stages: plan.stages.map((s) => ({ ...s, status: 'pending' })),
        stateMap: {},
        artifacts: {},
      }

      store.recordPipeline(pipelineData)

      // Execute DAG asynchronously
      const executor = async (stage, context) => {
        const role = cfg.roles[stage.roleId] || getDefaultRoles()[stage.roleId]
        return await executeStageWorker(stage, {
          pipeline: pipelineData,
          agentRole: role,
          config: cfg,
          callLlm,
          upstreamOutputs: context.upstreamOutputs,
        })
      }

      executeDAG({
        stages: plan.stages,
        executor,
        concurrency: 4,
        onNodeStart: (node) => {
          store.updatePipeline(pipelineData.pipelineId, (p) => {
            const s = p.stages.find((st) => st.id === node.id)
            if (s) s.status = 'running'
          })
        },
        onNodeComplete: async (node) => {
          store.updatePipeline(pipelineData.pipelineId, (p) => {
            const s = p.stages.find((st) => st.id === node.id)
            if (s) {
              s.status = 'completed'
              s.output = node.output
              s.metrics = node.metrics
            }
          })

          if (pipelineData.taskId && cfg.kanbanSync?.enabled) {
            await kanbanBridge.syncStageProgress(pipelineData.taskId, node, pipelineData.stages)
          }
        },
        onNodeFail: (node) => {
          store.updatePipeline(pipelineData.pipelineId, (p) => {
            const s = p.stages.find((st) => st.id === node.id)
            if (s) s.status = 'failed'
          })
        },
      })
        .then((summary) => {
          store.recordCompletion(pipelineData.pipelineId, summary)
        })
        .catch((err) => {
          console.error('[dsh-agent-orchestrator] Pipeline execution error:', err)
          store.recordCompletion(pipelineData.pipelineId, { success: false, error: err?.message })
        })

      return pipelineData
    },
  }

  // Register WebServer routes
  registerOrchestratorRoutes(ctx, { store, runner, getConfig, updateConfig })

  // Register DSH tools
  const renderToolOutput = (_a, v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }]

  ctx.effect(() => {
    return ctx.tools.register(
      defineTool({
        name: 'orchestrator_dispatch',
        description: 'Dispatch a multi-agent orchestrated pipeline to decompose and execute a complex task across specialized roles (Architecture, Spec, UI Design, Code, QA, Docs).',
        parameters: {
          taskTitle: { type: 'string', required: true, description: 'Concise title of the objective' },
          taskDescription: { type: 'string', required: true, description: 'Detailed functional requirements and scope' },
          scenarioId: {
            type: 'string',
            description: 'Complexity scenario (auto, hotfix, simple, medium, complex, enterprise)',
          },
        },
        output: { schema: { type: 'string' }, render: renderToolOutput },
        async execute(args) {
          const res = await runner.startPipeline(args)
          return JSON.stringify({
            status: 'started',
            pipelineId: res.pipelineId,
            scenario: res.scenarioTitle,
            stages: res.stages.map((s) => ({ id: s.id, name: s.name, role: s.roleName })),
          }, null, 2)
        },
      })
    )
  }, 'dsh-agent-orchestrator: dispatch tool')

  // Listen to session messages for /orchestrate or /orc command
  ctx.effect(() => {
    return ctx.on('session/event', async (session, event) => {
      if (!session || event?.type !== 'input/user') return

      const text = String(event.text || event.content || '').trim()
      const match = text.match(/^\/(?:orchestrate|orc)(?:\s+(.*))?$/i)
      if (!match) return

      const rest = (match[1] || '').trim()
      let taskTitle = rest || 'Interactive Orchestrated Task'
      let scenarioId = 'auto'

      // Parse optional leading [scenario]
      const parts = rest.split(/\s+/)
      const validScenarios = ['hotfix', 'simple', 'medium', 'complex', 'enterprise']
      if (parts.length > 1 && validScenarios.includes(parts[0].toLowerCase())) {
        scenarioId = parts[0].toLowerCase()
        taskTitle = parts.slice(1).join(' ')
      }

      try {
        const pipeline = await runner.startPipeline({
          taskTitle,
          taskDescription: taskTitle,
          scenarioId,
        })

        // Output confirmation back to the session
        if (typeof session.reply === 'function') {
          session.reply(
            `🚀 **Multi-Agent Orchestrator Pipeline Started**\n` +
            `- **Scenario**: ${pipeline.scenarioTitle}\n` +
            `- **Pipeline ID**: \`${pipeline.pipelineId}\`\n` +
            `- **Stages**: ${pipeline.stages.map((s) => `\n  - [ ] **${s.name}** (${s.roleName})`).join('')}\n\n` +
            `*Prefix cache optimization active. Deliverables will stream into this session.*`
          )
        }
      } catch (err) {
        if (typeof session.reply === 'function') {
          session.reply(`❌ Failed to dispatch pipeline: ${err?.message || err}`)
        }
      }
    })
  }, 'dsh-agent-orchestrator: slash command listener')
}

