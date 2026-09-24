/**
 * DeepSeek Harness Multi-Agent Orchestrator Plugin (Host Half)
 *
 * Scoped Name: @goodandready/dsh-agent-orchestrator
 * Short ID: dsh-agent-orchestrator
 */

import { randomUUID } from 'crypto'
// Safe peerDependency resolution with standalone fallback
function createSchemaStub(target = {}) {
  return new Proxy(target, {
    get(t, prop) {
      if (prop === 'shape') return t.shape || {}
      return (...args) => createSchemaStub({ ...t, [prop]: args[0] })
    }
  })
}

let z
try {
  const mod = await import('@deepseek-ai/schemastery')
  z = mod.default || mod
} catch {
  z = {
    object: (shape) => createSchemaStub({ shape }),
    boolean: () => createSchemaStub({ type: 'boolean' }),
    string: () => createSchemaStub({ type: 'string' }),
    number: () => createSchemaStub({ type: 'number' }),
    union: () => createSchemaStub({ type: 'union' }),
    array: () => createSchemaStub({ type: 'array' }),
  }
}

let defineTool
try {
  const mod = await import('@deepseek-ai/dsh-tools')
  defineTool = mod.defineTool || ((def) => def)
} catch {
  defineTool = (def) => def
}
import { getDefaultRoles, getDefaultScenarios } from './pipeline/scenarios.js'
import { decomposeTask } from './pipeline/decomposer.js'
import { executeDAG } from './pipeline/dag-engine.js'
import { executeStageWorker } from './pipeline/worker-pool.js'
import { executeDirectDelegation, toRolesArray, computeDelegationDepth } from './pipeline/delegation.js'
import { SerializationGate } from './pipeline/concurrency-gate.js'
import { SessionLifecycleManager } from './pipeline/session-lifecycle.js'
import { detectOrchestratorIntent } from './pipeline/intent.js'
import { readModelSelection, fetchModelCatalog } from './pipeline/model-selection.js'
import { applyGuidance } from './pipeline/guidance.js'
import { OrchestratorStore } from './store.js'
import { KanbanBridge } from './integrations/kanban-bridge.js'
import { registerOrchestratorRoutes } from './routes.js'
import { SnapshotManager } from './pipeline/snapshots.js'
import { syncDefaultPresets } from './pipeline/preset-sync.js'

export const name = '@goodandready/dsh-agent-orchestrator'
export const inject = ['settings', 'webServer', 'llm', 'tools', 'commands', 'systemPrompt', 'subagents']

export const Config = z.object({
  enabled: z.boolean().default(true).description('Enable Multi-Agent Orchestrator pipeline dispatcher'),
  defaultScenario: z.string().default('auto').description('Default complexity scenario (auto, hotfix, simple, medium, complex, enterprise)'),
  disableNestedDelegation: z.boolean().default(false).description('Anti-Matryoshka Guard: Disallow subagents from spawning nested subagents (Issue #19)'),
  maxConcurrentSubagents: z.number().default(3).description('Maximum concurrent subagents per parent session (Issue #93)'),
  subagentGracePeriodMs: z.number().default(180000).description('Grace period before archiving completed one-shot subagents (Issue #56)'),
  smartModelRouting: z.boolean().default(false).description('Smart Model Routing: dynamically select model based on task complexity (Issue #48)'),
  allowedProviders: z.array(z.string()).default([]).description('Whitelist of allowed LLM provider IDs (Issue #48)'),
  failFastModelValidation: z.boolean().default(false).description('Fail-fast when requested model is not found in provider registry (Issue #82)'),
  maxStoredSessions: z.number().default(400).description('Capacity recycling threshold for subagent sessions (Issue #67)'),
  sessionRetentionMs: z.number().default(86400000).description('Retention duration in ms for sessions-archive before physical deletion (Issue #57)'),
})

export function apply(ctx, config = {}) {
  const NS = 'dsh-agent-orchestrator'
  const logger = ctx?.logger || {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }
  let currentSettings = {
    ...config,
    disableNestedDelegation: Boolean(config.disableNestedDelegation),
    smartModelRouting: Boolean(config.smartModelRouting),
    allowedProviders: Array.isArray(config.allowedProviders) ? config.allowedProviders : [],
    failFastModelValidation: Boolean(config.failFastModelValidation),
    maxStoredSessions: config.maxStoredSessions || 400,
    sessionRetentionMs: config.sessionRetentionMs || 86400000,
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
            disableNestedDelegation: saved.disableNestedDelegation ?? currentSettings.disableNestedDelegation,
            roles: saved.roles || getDefaultRoles(),
            scenarios: saved.scenarios || getDefaultScenarios(),
            kanbanSync: { ...currentSettings.kanbanSync, ...(saved.kanbanSync || {}) },
          }
        }
      }
    } catch (e) {
      logger.warn('[dsh-agent-orchestrator] Settings register warning:', e?.message || e)
    }
  })

  const getConfig = () => currentSettings
  const updateConfig = async (partial) => {
    currentSettings = { ...currentSettings, ...partial }
    if (settingsScope) {
      try {
        for (const [k, v] of Object.entries(partial)) {
          if (k === 'enabled' || k === 'defaultScenario' || k === 'disableNestedDelegation') {
            await settingsScope.set(k, v)
          }
        }
      } catch (err) {
        logger.debug('[dsh-agent-orchestrator] Settings update warning:', err?.message || err)
      }
    }
  }

  // Self-Syncing Presets & Roles (Issue #107)
  const syncResult = syncDefaultPresets({
    currentRoles: currentSettings.roles,
    currentScenarios: currentSettings.scenarios,
    logger,
  })
  currentSettings.roles = syncResult.roles
  currentSettings.scenarios = syncResult.scenarios

  const snapshotManager = new SnapshotManager({ logger })
  const store = new OrchestratorStore({ logger })
  const kanbanBridge = new KanbanBridge({
    port: ctx.webServer?.port || 3080,
    fetchImpl: globalThis.fetch,
  })

  const serializationGate = new SerializationGate(currentSettings.maxConcurrentSubagents || 3)
  const sessionLifecycle = new SessionLifecycleManager({
    gracePeriodMs: currentSettings.subagentGracePeriodMs,
    maxCapacity: currentSettings.maxStoredSessions || 400,
    retentionMs: currentSettings.sessionRetentionMs || 86400000,
    subagentsService: ctx.subagents,
    sessionsService: (typeof ctx.get === 'function' ? ctx.get('sessions', false) : null) || null,
  })

  // Track active execution controllers for clean lifecycle teardown
  const activeControllers = new Set()

  ctx.effect(() => () => {
    // Dispose / cleanup all active child runs
    for (const ctrl of activeControllers) {
      try {
        ctrl.abort(new Error('Plugin unmounted or restarted'))
      } catch (err) {
        logger.debug('[dsh-agent-orchestrator] Controller abort error:', err?.message || err)
      }
    }
    activeControllers.clear()
    sessionLifecycle.dispose()
  }, 'dsh-agent-orchestrator: lifecycle resource cleanup')

  /**
   * Unified LLM caller wrapping ctx.llm.prepareCall().stream()
   */
  const callLlm = async ({ provider, model, messages, temperature = 0.3, maxTokens = 4096, reasoningEffort, onStreamDelta }) => {
    if (!ctx.llm) {
      throw new Error('ctx.llm is not available in cordis context')
    }

    // Resolve provider aliases (e.g. 'deepseek' -> 'deepseek-official')
    let resolvedProvider = provider || 'deepseek-official'
    try {
      const providers = typeof ctx.llm.listProviders === 'function' ? ctx.llm.listProviders() : []
      if (providers.length > 0) {
        if (provider === 'deepseek' && providers.some((p) => p.id === 'deepseek-official')) {
          resolvedProvider = 'deepseek-official'
        } else if (!providers.some((p) => p.id === provider)) {
          const ds = providers.find((p) => p.id === 'deepseek-official' || p.id === 'deepseek')
          if (ds) resolvedProvider = ds.id
        }
      }
    } catch (_) {
          /* safe ignore */
        }

    const callConfig = {
      provider: resolvedProvider,
      model,
      temperature,
      maxTokens,
      ...(reasoningEffort && reasoningEffort !== 'off' ? { reasoningEffort, reasoning_effort: reasoningEffort } : {}),
    }

    let prep
    try {
      prep = await ctx.llm.prepareCall(callConfig)
    } catch (err) {
      throw new Error(`Failed to prepareCall for ${resolvedProvider}:${model} (${err?.message || err})`)
    }

    if (!prep || typeof prep.stream !== 'function') {
      throw new Error(`LLM provider/model ${resolvedProvider}:${model} does not support streaming`)
    }

    const abortCtrl = new AbortController()
    activeControllers.add(abortCtrl)
    const timeoutId = setTimeout(() => abortCtrl.abort(new Error('LLM call timeout (120s)')), 120000)
    timeoutId.unref?.()

    const normalizedMessages = (messages || []).map((m) => {
      if (typeof m.content === 'string') {
        return {
          id: m.id || randomUUID(),
          role: m.role,
          content: [{ type: 'text', text: m.content }],
        }
      }
      return m
    })

    try {
      const stream = prep.stream({
        ...prep.config,
        messages: normalizedMessages,
        signal: abortCtrl.signal,
      })

      let fullText = ''
      let usageInfo = null

      for await (const chunk of stream) {
        if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
          const failMsg =
            chunk.reason.failure?.message ||
            chunk.reason.failure?.detail ||
            JSON.stringify(chunk.reason.failure || chunk.reason)
          throw new Error(`LLM stream finished with error: ${failMsg}`)
        }

        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          fullText += chunk.text
          if (typeof onStreamDelta === 'function') {
            onStreamDelta(chunk.text)
          }
        } else if (chunk.type === 'block-end' && chunk.block?.text) {
          if (!fullText) fullText = chunk.block.text
        } else if (typeof chunk.delta?.text === 'string') {
          fullText += chunk.delta.text
          if (typeof onStreamDelta === 'function') {
            onStreamDelta(chunk.delta.text)
          }
        } else if (typeof chunk.text === 'string' && !chunk.type) {
          fullText += chunk.text
        } else if (chunk.type === 'usage' && chunk.usage) {
          usageInfo = chunk.usage
        }
      }

      clearTimeout(timeoutId)
      activeControllers.delete(abortCtrl)
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
      activeControllers.delete(abortCtrl)
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
        store.updateStage(plan.pipelineId, stage.id, {
          status: 'running',
          startedAt: Date.now(),
        })

        const rolesList = toRolesArray(cfg.roles)
        const role = rolesList.find((r) => r.id === stage.roleId) || {
          id: stage.roleId,
          displayName: stage.roleName,
          defaultModel: { provider: 'deepseek-official', model: 'deepseek-chat' },
          systemPrompt: 'You are a specialized autonomous engineer. Produce clear, production-ready deliverables.',
        }

        const modelSelection = readModelSelection(ctx)

        try {
          const result = await executeStageWorker(stage, {
            pipeline: pipelineData,
            agentRole: role,
            config: cfg,
            callLlm,
            upstreamOutputs: context.upstreamOutputs,
            logger,
            allowedRoutes: modelSelection.allowedRoutes,
            onStreamDelta: (delta) => {
              store.appendStageLog(plan.pipelineId, stage.id, delta)
            },
          })

          store.updateStage(plan.pipelineId, stage.id, {
            status: 'completed',
            completedAt: Date.now(),
            output: result.output,
            metrics: result.metrics,
          })

          return result.output
        } catch (stageErr) {
          store.updateStage(plan.pipelineId, stage.id, {
            status: 'failed',
            completedAt: Date.now(),
            error: stageErr?.message || String(stageErr),
          })
          throw stageErr
        }
      }

      executeDAG({
        stages: plan.stages,
        executor,
        concurrency: 3,
      })
        .then(async (dagResult) => {
          store.recordCompletion(plan.pipelineId, {
            ...dagResult,
            durationMs: Date.now() - pipelineData.startedAt,
          })

          // Sync to Kanban if enabled
          const syncConfig = cfg.kanbanSync
          if (syncConfig?.enabled) {
            try {
              let targetTaskId = taskId
              if (!targetTaskId) {
                const createdTask = await kanbanBridge.createTask({
                  title: `[Orchestrated] ${plan.taskTitle}`,
                  description: `Pipeline ID: \`${plan.pipelineId}\`\nScenario: \`${plan.scenarioTitle}\`\nObjective: ${plan.taskDescription}`,
                })
                targetTaskId = createdTask?.id
              }

              if (targetTaskId) {
                if (syncConfig.createChecklist) {
                  const checklistItems = plan.stages.map((s) => ({
                    title: `${s.name} (${s.roleName})`,
                    completed: dagResult?.stateMap?.[s.id]?.status === 'completed',
                  }))
                  await kanbanBridge.syncStageChecklist(targetTaskId, checklistItems)
                }

                if (syncConfig.targetColumn) {
                  await kanbanBridge.moveTask(targetTaskId, syncConfig.targetColumn)
                }
              }
            } catch (kErr) {
              logger.warn('[dsh-agent-orchestrator] Kanban sync error:', kErr?.message || kErr)
            }
          }

          // Record Dispatch Snapshot (Issue #109)
          try {
            snapshotManager.createSnapshot({
              id: plan.pipelineId,
              title: plan.taskTitle,
              scenarioId: plan.scenarioId,
              status: dagResult?.success ? 'completed' : 'failed',
              stages: plan.stages,
              durationMs: Date.now() - pipelineData.startedAt,
            })
          } catch (snapErr) {
            logger.debug('[dsh-agent-orchestrator] Snapshot record skipped:', snapErr?.message || snapErr)
          }
        })
        .catch((dagErr) => {
          store.recordCompletion(plan.pipelineId, {
            success: false,
            durationMs: Date.now() - pipelineData.startedAt,
            error: dagErr?.message || String(dagErr),
          })
        })

      return pipelineData
    },
  }

  // Register Web REST API Routes
  registerOrchestratorRoutes(ctx, {
    store,
    runner,
    getConfig,
    updateConfig,
    callLlm,
    snapshotManager,
  })

  // Inject systemPrompt specialist roster (so the main chat agent knows about all 12 roles)
  applyGuidance(ctx, () => getConfig().roles, 'orchestrator_delegate_specialist', { logger })

  // Register model-facing tools via tools service
  const registerToolsOnContext = (targetCtx) => {
    if (!targetCtx.tools || typeof targetCtx.tools.register !== 'function') return
    const render = (_a, v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }]

    targetCtx.effect(() => {
      const disposers = []

      // 1. Full Multi-Agent Pipeline Dispatcher
      try {
        disposers.push(
          targetCtx.tools.register(
            defineTool({
              name: 'orchestrator_dispatch',
              description:
                'Dispatch a multi-agent orchestrated pipeline to decompose and execute a complex task across specialized roles (Architecture, Spec, UI Design, Code, QA, Docs).',
              parameters: {
                taskTitle: { type: 'string', required: true, description: 'Concise title of the objective' },
                taskDescription: { type: 'string', required: true, description: 'Detailed functional requirements and scope' },
                scenarioId: {
                  type: 'string',
                  description: 'Complexity scenario (auto, hotfix, simple, medium, complex, enterprise)',
                },
              },
              output: { schema: { type: 'string' }, render },
              async execute(args) {
                const res = await runner.startPipeline(args)
                return JSON.stringify(
                  {
                    status: 'started',
                    pipelineId: res.pipelineId,
                    scenario: res.scenarioTitle,
                    stages: res.stages.map((s) => ({ id: s.id, name: s.name, role: s.roleName })),
                  },
                  null,
                  2
                )
              },
            })
          )
        )
        logger.debug('[dsh-agent-orchestrator] Registered tool: orchestrator_dispatch')
      } catch (e) {
        logger.error('[dsh-agent-orchestrator] Failed to register orchestrator_dispatch:', e)
      }

      // 2. Direct Single Specialist Delegation Tool (In-Chat Subagent)
      try {
        disposers.push(
          targetCtx.tools.register(
            defineTool({
              name: 'orchestrator_delegate_specialist',
              description:
                'Delegate a focused task directly to a specialized autonomous subagent (e.g. ui_design, architecture, spec, frontend, backend, qa_tests, code_review, security_audit, devops, docs, data_engineer, dba) without running a full multi-stage DAG pipeline. Returns the specialist deliverable directly into this turn.',
              parameters: {
                roleId: {
                  type: 'string',
                  required: true,
                  description:
                    'Target role identifier: architecture, spec, ui_design, frontend, backend, qa_tests, code_review, security_audit, devops, docs, data_engineer, dba',
                },
                task: {
                  type: 'string',
                  required: true,
                  description: 'The complete, self-contained task and instructions for the specialist subagent.',
                },
                context: {
                  type: 'string',
                  description: 'Optional existing code, guidelines, or conversation context relevant to the task.',
                },
                iteration: {
                  type: 'integer',
                  description: 'Optional iteration number for rework/refinement cycles (e.g. 2, 3).',
                },
                feedback: {
                  type: 'string',
                  description: 'Optional review feedback from previous iteration to send to subagent.',
                },
                status: {
                  type: 'string',
                  description: 'Optional review status: "accepted", "rework", or "in_progress". Default: "accepted"',
                },
                capability: {
                  type: 'string',
                  description: 'Optional semantic capability requirement: coding, reasoning, fast, general',
                },
                reasoningEffort: {
                  type: 'string',
                  description: 'Optional reasoning effort level: off, low, medium, high, max',
                },
                maxTokens: {
                  type: 'integer',
                  description: 'Optional custom ceiling for output tokens',
                },
              },
              output: { schema: { type: 'string' }, render },
              async execute(args, execCtx) {
                const cfg = {
                  ...getConfig(),
                  registryProviders: typeof ctx.llm?.listProviders === 'function' ? ctx.llm.listProviders() : [],
                }
                const modelSelection = readModelSelection(ctx)
                const currentDepth = computeDelegationDepth(execCtx)
                const isChildSession = Boolean(execCtx?.session?.parentId || execCtx?.session?.parent || currentDepth > 0)
                const result = await executeDirectDelegation({
                  roleId: args.roleId,
                  task: args.task,
                  context: args.context || '',
                  roles: cfg.roles,
                  config: cfg,
                  callLlm,
                  allowedRoutes: modelSelection.allowedRoutes,
                  serializationGate,
                  sessionLifecycle,
                  currentDepth,
                  isChildSession,
                  capability: args.capability,
                  reasoningEffort: args.reasoningEffort,
                  maxTokens: args.maxTokens,
                })

                const hitPct = ((result.metrics?.hitRatio ?? 0) * 100).toFixed(1)
                const savingsPct = result.metrics?.estimatedSavingsPct ?? 0

                const isRework = Boolean(
                  args.feedback || (args.iteration && args.iteration > 1) || args.status === 'rework'
                )
                const iterationNum = args.iteration || (isRework ? 2 : 1)
                const statusBadge = isRework
                  ? `> 🟡 **Result received from subagent [${result.roleName}] and sent for rework (iteration ${iterationNum})**`
                  : `> 🟢 **Subagent result accepted by orchestrator [${result.roleName}]**`

                return (
                  `${statusBadge}\n` +
                  `> *Specialist: \`${result.roleId}\` | Model: \`${result.model}\` | Prompt Cache Hit: ${hitPct}% (Savings: ~${savingsPct}%)*\n\n` +
                  `${result.output}`
                )
              },
            })
          )
        )
        logger.debug('[dsh-agent-orchestrator] Registered tool: orchestrator_delegate_specialist')
      } catch (e) {
        logger.error('[dsh-agent-orchestrator] Failed to register orchestrator_delegate_specialist:', e)
      }

      // 3. Named Agent Pool Runner Tool (agent_run by name - Issue #84 & #110 & #2 & #3)
      try {
        disposers.push(
          targetCtx.tools.register(
            defineTool({
              name: 'agent_run',
              description:
                'Run a specialized subagent from the agent pool by name (e.g. architecture, spec, ui_design, frontend, backend, qa_tests, code_review, security_audit, devops, docs, data_engineer, dba). Supports one-shot deliverables and continuable interactive subagents with automatic tool intersection security and pinned non-interactive approvals.',
              parameters: {
                name: {
                  type: 'string',
                  required: true,
                  description:
                    'Specialist agent name or role ID from {{subagent_pool}} (e.g. architecture, code, qa_tests, ui_design, docs, devops, security, spec, backend, frontend)',
                },
                task: {
                  type: 'string',
                  required: true,
                  description: 'The specific, actionable task description for the specialist subagent.',
                },
                mode: {
                  type: 'string',
                  description: 'Execution mode: "one-shot" (default standalone task completion) or "continuable" (interactive multi-turn subagent).',
                },
                cwd: {
                  type: 'string',
                  description: 'Optional working directory path relative to project root (e.g. packages/core, src/ui).',
                },
                context: {
                  type: 'string',
                  description: 'Optional additional context, prior deliverable, or code excerpts.',
                },
              },
              output: {
                schema: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    success: { type: 'boolean' },
                    name: { type: 'string' },
                    roleName: { type: 'string' },
                    output: { type: 'string' },
                    childSessionId: { type: 'string' },
                  },
                },
                render: (_a, v) => [
                  {
                    type: 'text',
                    text:
                      typeof v === 'string'
                        ? v
                        : v?.output || JSON.stringify(v, null, 2),
                  },
                ],
              },
              async execute(args, execCtx) {
                const parentTools = targetCtx.tools?.schemas ? targetCtx.tools.schemas() : []
                const currentDepth = computeDelegationDepth(execCtx)
                const isChildSession = Boolean(execCtx?.session?.parentId || execCtx?.session?.parent || currentDepth > 0)
                const runCfg = {
                  ...getConfig(),
                  registryProviders: typeof ctx.llm?.listProviders === 'function' ? ctx.llm.listProviders() : [],
                }
                const res = await executeDirectDelegation({
                  roleId: args.name,
                  task: args.task,
                  mode: args.mode || 'one-shot',
                  cwd: args.cwd,
                  context: args.context || '',
                  roles: runCfg.roles,
                  config: runCfg,
                  callLlm,
                  subagents: ctx.subagents,
                  parentTools,
                  parentSessionId: execCtx?.session?.id || execCtx?.sessionId,
                  allowedRoutes: readModelSelection(ctx).allowedRoutes,
                  serializationGate,
                  sessionLifecycle,
                  currentDepth,
                  isChildSession,
                  signal: execCtx?.signal,
                })
                return res
              },
            })
          )
        )
        logger.debug('[dsh-agent-orchestrator] Registered tool: agent_run')
      } catch (e) {
        logger.error('[dsh-agent-orchestrator] Failed to register agent_run:', e)
      }

      // 4. Dynamic Model & Subagent Catalog Tool (Issue #76)
      try {
        disposers.push(
          targetCtx.tools.register(
            defineTool({
              name: 'model_subagent_catalog',
              description:
                'Query dynamic live catalog of available LLM providers, models, capabilities (coding, reasoning, fast, general), max output tokens, and reasoning effort support.',
              parameters: {
                provider: {
                  type: 'string',
                  description: 'Optional provider filter (e.g. "deepseek-official", "deepseek", "openrouter", "ollama", "anthropic")',
                },
                capability: {
                  type: 'string',
                  description: 'Optional semantic capability filter ("coding", "reasoning", "fast", "general")',
                },
              },
              output: { schema: { type: 'string' }, render },
              async execute(args) {
                const catalog = await fetchModelCatalog(ctx, {
                  provider: args.provider,
                  capability: args.capability,
                })
                return JSON.stringify(
                  {
                    total: catalog.length,
                    catalog,
                  },
                  null,
                  2
                )
              },
            })
          )
        )
        logger.debug('[dsh-agent-orchestrator] Registered tool: model_subagent_catalog')
      } catch (e) {
        logger.error('[dsh-agent-orchestrator] Failed to register model_subagent_catalog:', e)
      }

      return () => {
        for (const d of disposers) {
          try { if (typeof d === 'function') d() } catch (_) {
          /* safe ignore */
        }
        }
      }
    }, 'dsh-agent-orchestrator: registered model tools')
  }

  if (ctx.tools?.register) {
    registerToolsOnContext(ctx)
  } else {
    ctx.inject(['tools'], (tctx) => registerToolsOnContext(tctx))
  }

  // Helper to handle pipeline dispatch triggered from chat
  const handlePipelineDispatch = async ({ taskTitle, scenarioId, targetAgent, targetSession }) => {
    try {
      const pipeline = await runner.startPipeline({
        taskTitle,
        taskDescription: taskTitle,
        scenarioId: scenarioId || 'auto',
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

      if (targetAgent && typeof targetAgent.followup === 'function') {
        try {
          targetAgent.followup({
            id: randomUUID(),
            role: 'user',
            content: [{ type: 'text', text: responseText }],
            source: { kind: 'user' },
          })
        } catch (_) {
          /* safe ignore */
        }
      }

      if (targetSession) {
        if (typeof targetSession.reply === 'function') {
          targetSession.reply(responseText)
        } else if (typeof targetSession.append === 'function') {
          targetSession.append('message', {
            id: randomUUID(),
            role: 'assistant',
            content: [{ type: 'text', text: responseText }],
          })
        }
      }

      return { kind: 'success', text: responseText }
    } catch (err) {
      const errMsg = `❌ Failed to dispatch pipeline: ${err?.message || err}`
      if (targetAgent && typeof targetAgent.followup === 'function') {
        try {
          targetAgent.followup({
            id: randomUUID(),
            role: 'user',
            content: [{ type: 'text', text: errMsg }],
            source: { kind: 'user' },
          })
        } catch (_) {
          /* safe ignore */
        }
      }
      return { kind: 'error', text: errMsg }
    }
  }

  // Chat slash commands: /orchestrate and /orc via commands service
  ctx.inject(['commands'], (cctx) => {
    try {
      if (typeof cctx.commands?.register !== 'function') return

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
      } catch (_) {
          /* safe ignore */
        }

      const commandHandler = async (invocation) => {
        const raw =
          invocation?.rawInput ??
          invocation?.line ??
          invocation?.input ??
          (typeof invocation === 'string' ? invocation : '')
        const text = String(raw || '').trim()
        const intent = detectOrchestratorIntent(`/orchestrate ${text}`)
        return handlePipelineDispatch({
          taskTitle: intent.taskTitle || text || 'Interactive Orchestrated Task',
          scenarioId: intent.scenarioId || 'auto',
          targetAgent: invocation?.agent,
        })
      }

      const unregister1 = cctx.commands.register({
        name: 'orchestrate',
        description: 'Multi-Agent Orchestrator: decompose task and dispatch across specialized roles with prompt caching',
        input: { hint: '[hotfix|simple|medium|complex|enterprise] <task objective>' },
        handler: commandHandler,
      })

      const unregister2 = cctx.commands.register({
        name: 'orc',
        description: 'Alias for /orchestrate',
        input: { hint: '[hotfix|simple|medium|complex|enterprise] <task objective>' },
        handler: commandHandler,
      })

      // Roster Viewer Slash Command (Issue #105)
      const rosterHandler = async (invocation) => {
        const rolesList = toRolesArray(getConfig().roles || getDefaultRoles())
        const rows = [
          '| Name | Role ID | Model | Status | maxTokens | Skills/Tools |',
          '| :--- | :--- | :--- | :---: | :---: | :--- |',
        ]
        for (const r of rolesList) {
          const modelStr = r.defaultModel ? `${r.defaultModel.provider}:${r.defaultModel.model}` : 'default'
          const statusStr = r.enabled !== false ? 'Active' : 'Disabled'
          const maxTok = r.maxTokens || 4096
          const skillsList = (r.skills || []).concat(r.tools || []).slice(0, 4).join(', ')
          rows.push(`| ${r.name || r.displayName || r.id} | \`${r.id}\` | ${modelStr} | ${statusStr} | ${maxTok} | ${skillsList} |`)
        }
        const output = `### Multi-Agent Orchestrator: Agent Roster (${rolesList.length} specialists)\n\n${rows.join('\n')}`
        if (invocation?.agent && typeof invocation.agent.followup === 'function') {
          try {
            invocation.agent.followup({
              id: randomUUID(),
              role: 'assistant',
              content: [{ type: 'text', text: output }],
            })
          } catch (_) {
            /* safe ignore */
          }
        }
        return { kind: 'success', text: output }
      }

      const unregister3 = cctx.commands.register({
        name: 'subagents',
        description: 'View orchestrator agent roster, capabilities, and active statuses (Issue #105)',
        handler: rosterHandler,
      })

      const unregister4 = cctx.commands.register({
        name: 'roster',
        description: 'Alias for /subagents roster viewer (Issue #105)',
        handler: rosterHandler,
      })

      if (typeof cctx.effect === 'function') {
        cctx.effect(() => () => {
          try {
            if (typeof unregister1 === 'function') unregister1()
            if (typeof unregister2 === 'function') unregister2()
            if (typeof unregister3 === 'function') unregister3()
            if (typeof unregister4 === 'function') unregister4()
          } catch (_) {
            /* safe ignore */
          }
        }, 'dsh-agent-orchestrator: commands unregister')
      }
    } catch (err) {
      logger.warn('[dsh-agent-orchestrator] Commands register warning:', err?.message || err)
    }
  })

  // Auto-archive one-shot subagents on completion (Issue #56)
  ctx.effect(() => {
    return ctx.on('subagent/end', (session) => {
      const id = session?.id || session?.sessionId
      if (id) {
        sessionLifecycle.markCompleted(id, { event: 'subagent/end' })
      }
    })
  }, 'dsh-agent-orchestrator: subagent/end lifecycle listener')

  // Natural Language Chat Listener (session/event)
  // Detects orchestrator triggers: "/orchestrate ...", "orchestrate: ...", etc.
  ctx.effect(() => {
    return ctx.on('session/event', async (session, event) => {
      if (!session || event?.type !== 'input/user') return

      const text = String(event.text || event.content || '').trim()
      const intent = detectOrchestratorIntent(text)

      if (intent.isTrigger && intent.action === 'on') {
        await handlePipelineDispatch({
          taskTitle: intent.taskTitle || 'Interactive Orchestrated Task',
          scenarioId: intent.scenarioId || 'auto',
          targetSession: session,
        })
      }
    })
  }, 'dsh-agent-orchestrator: natural language chat listener')
}
