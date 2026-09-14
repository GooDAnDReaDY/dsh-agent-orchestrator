/**
 * DeepSeek Harness Multi-Agent Orchestrator Plugin (Host Half)
 *
 * Scoped Name: @goodandready/dsh-agent-orchestrator
 * Short ID: dsh-agent-orchestrator
 */

import { randomUUID } from 'crypto'
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
export const inject = ['settings', 'webServer', 'llm', 'tools', 'commands']

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
    kanbanSync: {
      enabled: false,
      targetColumn: 'review',
      createChecklist: true,
      ...(config.kanbanSync || {}),
    },
  }

  let settingsScope = null

  // Register settings scope
  ctx.inject(['settings'], (sctx) => {
    try {
      const scope = sctx.settings.register(NS, Config, { base: config })
      if (scope) {
        settingsScope = scope
        const saved = scope.get()
        if (saved) {
          currentSettings = {
            ...currentSettings,
            ...saved,
            roles: saved.roles || getDefaultRoles(),
            scenarios: saved.scenarios || getDefaultScenarios(),
            kanbanSync: { ...currentSettings.kanbanSync, ...(saved.kanbanSync || {}) },
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
    if (settingsScope) {
      try {
        for (const [k, v] of Object.entries(partial)) {
          if (k === 'enabled' || k === 'defaultScenario') {
            await settingsScope.set(k, v)
          }
        }
      } catch (_) {}
    }
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
            await kanbanBridge.syncStageProgress(pipelineData.taskId, node, pipelineData.stages, cfg.kanbanSync?.targetColumn || 'Done')
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

  // Chat slash commands: /orchestrate and /orc via commands service
  ctx.inject(['commands'], (cctx) => {
    try {
      if (typeof cctx.commands?.register !== 'function') return

      // Clear conflicting command registrations from other plugins (e.g. subagent-director)
      try {
        const globalLayer = cctx.commands?.layers?.global
        if (globalLayer?.commands?.data instanceof Map) {
          if (globalLayer.commands.data.has('orchestrate')) {
            globalLayer.commands.data.delete('orchestrate')
          }
          if (globalLayer.commands.data.has('orc')) {
            globalLayer.commands.data.delete('orc')
          }
        }
      } catch (_) {}

      const handleCommand = async (invocation) => {
        const raw = invocation?.rawInput ?? invocation?.line ?? invocation?.input ?? (typeof invocation === 'string' ? invocation : '')
        const text = String(raw || '').trim()
        let taskTitle = text || 'Interactive Orchestrated Task'
        let scenarioId = 'auto'

        const parts = text.split(/\s+/)
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

          const stagesFormatted = pipeline.stages
            .map((s, i) => `  ${i + 1}. **${s.name}** — *${s.roleName}* (${s.assignedModel?.model || 'deepseek-chat'})`)
            .join('\n')

          const responseText =
            `🚀 **Multi-Agent Orchestrator Pipeline Dispatched**\n\n` +
            `- **Scenario**: \`${pipeline.scenarioTitle}\`\n` +
            `- **Pipeline ID**: \`${pipeline.pipelineId}\`\n` +
            `- **Objective**: ${pipeline.taskTitle}\n\n` +
            `**Execution Graph (DAG):**\n${stagesFormatted}\n\n` +
            `⚡ *Prompt Caching Active*: Prefix canonicalization enabled (>1024 token L1 static anchor + L2 task context). Downstream stages will stream deliverables with shared KV-cache.`

          // CRITICAL: Post message to active agent turn so it appears visibly in the chat conversation!
          const agent = invocation?.agent
          if (agent && typeof agent.followup === 'function') {
            try {
              agent.followup({
                id: randomUUID(),
                role: 'user',
                content: [{
                  type: 'text',
                  text: responseText,
                }],
                source: { kind: 'user' },
              })
            } catch (followupErr) {
              console.warn('[dsh-agent-orchestrator] Agent followup error:', followupErr?.message || followupErr)
            }
          }

          return { kind: 'success', text: responseText }
        } catch (err) {
          const errMsg = `❌ Failed to dispatch pipeline: ${err?.message || err}`
          const agent = invocation?.agent
          if (agent && typeof agent.followup === 'function') {
            try {
              agent.followup({
                id: randomUUID(),
                role: 'user',
                content: [{ type: 'text', text: errMsg }],
                source: { kind: 'user' },
              })
            } catch (_) {}
          }
          return { kind: 'error', text: errMsg }
        }
      }

      let unregister1 = null
      try {
        unregister1 = cctx.commands.register({
          name: 'orchestrate',
          description: 'Multi-Agent Orchestrator: decompose task and dispatch across specialized roles with prompt caching',
          input: { hint: '[hotfix|simple|medium|complex|enterprise] <task objective>' },
          handler: handleCommand,
        })
      } catch (e1) {
        console.warn('[dsh-agent-orchestrator] /orchestrate register warning:', e1?.message || e1)
      }

      let unregister2 = null
      try {
        unregister2 = cctx.commands.register({
          name: 'orc',
          description: 'Alias for /orchestrate',
          input: { hint: '[hotfix|simple|medium|complex|enterprise] <task objective>' },
          handler: handleCommand,
        })
      } catch (e2) {
        console.warn('[dsh-agent-orchestrator] /orc register warning:', e2?.message || e2)
      }

      cctx.effect(() => () => {
        try {
          if (typeof unregister1 === 'function') unregister1()
          if (typeof unregister2 === 'function') unregister2()
        } catch (_) {}
      }, 'dsh-agent-orchestrator: /orchestrate commands unregister')
    } catch (err) {
      console.warn('[dsh-agent-orchestrator] Commands register warning:', err?.message || err)
    }
  })

  // Extra fallback: Listen to session messages for /orchestrate or /orc command
  ctx.effect(() => {
    return ctx.on('session/event', async (session, event) => {
      if (!session || event?.type !== 'input/user') return

      const text = String(event.text || event.content || '').trim()
      const match = text.match(/^\/(?:orchestrate|orc)(?:\s+(.*))?$/i)
      if (!match) return

      const rest = (match[1] || '').trim()
      let taskTitle = rest || 'Interactive Orchestrated Task'
      let scenarioId = 'auto'

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

        const stagesFormatted = pipeline.stages
          .map((s, i) => `  ${i + 1}. **${s.name}** — *${s.roleName}* (${s.assignedModel?.model || 'deepseek-chat'})`)
          .join('\n')

        const responseText =
          `🚀 **Multi-Agent Orchestrator Pipeline Started**\n` +
          `- **Scenario**: ${pipeline.scenarioTitle}\n` +
          `- **Pipeline ID**: \`${pipeline.pipelineId}\`\n` +
          `- **Objective**: ${pipeline.taskTitle}\n\n` +
          `**Execution Graph (DAG):**\n${stagesFormatted}\n\n` +
          `*Prefix cache optimization active. Deliverables will stream into this session.*`

        if (typeof session.reply === 'function') {
          session.reply(responseText)
        } else if (typeof session.append === 'function') {
          session.append('message', {
            id: randomUUID(),
            role: 'assistant',
            content: [{ type: 'text', text: responseText }],
          })
        }
      } catch (err) {
        if (typeof session.reply === 'function') {
          session.reply(`❌ Failed to dispatch pipeline: ${err?.message || err}`)
        }
      }
    })
  }, 'dsh-agent-orchestrator: slash command listener')
}
