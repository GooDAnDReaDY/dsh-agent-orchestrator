/**
 * Direct Specialist Delegation Handler.
 *
 * Implements:
 * 1. MVO 1-to-1 Specialist Delegation (`orchestrator_delegate_specialist` and `agent_run`)
 * 2. KV-Cache Prompt Alignment fallback when native subagents service is absent.
 * 3. Bidirectional synonym bridge & safe tool intersection (Issue #2).
 * 4. Pinned non-interactive approvals (`approval: 'never'`) (Issue #110).
 * 5. Anti-Redelegation Shield (Issue #103): child subagents cannot receive delegation tools.
 * 6. Leaf Experts Guard (Issue #102): leaf specialized experts run with maxDepth: 1.
 * 7. Anti-Matryoshka Guard (Issue #19): hard limit on nesting depth (HARD_MAX_DEPTH = 3),
 *    and optional disableNestedDelegation configuration toggle.
 * 8. Adaptive tool sanitization diagnostics (`droppedTools`) (Issue #111).
 * 9. Per-Parent Serialization Gate & Concurrency Cap (Issue #93).
 * 10. Per-Call `cwd` Workspace Scoping & Sandbox containment check (Issue #87).
 * 11. Multi-layered Decision Trace Ledger in `presentationMeta` (≤4KB limit) (Issue #108).
 * 12. Session Lifecycle Auto-Archiving for one-shot subagents (Issue #56).
 * 13. Fail-Fast Model Validation with Candidate Shortlist (Issue #82).
 * 14. Smart Model Routing by task complexity tier (Issue #48).
 * 15. Deterministic Max-Tokens Watchdog with continue-once guarantee (Issue #75).
 */

import { randomUUID } from 'crypto'
import { resolveToolIntersection } from './intersection.js'
import { resolveSpecialistModel } from './model-selection.js'
import { resolveScopedCwd } from './concurrency-gate.js'
import { createDecisionTrace } from './decision-trace.js'
import { isMaxTokensTruncated, runWithMaxTokensWatchdog } from './token-watchdog.js'
import {
  buildStaticBaseAnchor,
  buildSharedTaskAnchor,
  formatCumulativeArtifacts,
  assembleAgentMessages,
  extractCacheMetrics,
} from './cache-prefixer.js'
import { callWithTransientRetry } from './worker-pool.js'
import { getDefaultRoles } from './scenarios.js'

export const HARD_MAX_DEPTH = 3
export const NESTED_DELEGATION_GUARD_MESSAGE =
  'Nested delegation is disabled by plugin policy (disableNestedDelegation=true).'
export const DELEGATION_DEPTH_LIMIT_MESSAGE =
  `Delegation depth limit reached: maximum allowed depth is ${HARD_MAX_DEPTH} (Anti-Matryoshka Guard).`

/**
 * Normalizes roles collection to a flat array.
 */
export function toRolesArray(roles) {
  if (!roles) return []
  if (Array.isArray(roles)) return roles
  if (typeof roles === 'object') {
    return Object.entries(roles).map(([k, v]) => ({
      id: v?.id || k,
      displayName: v?.displayName || v?.name || k,
      ...v,
    }))
  }
  return []
}

/**
 * Resolves alias (e.g. 'coder', 'разработчик', 'code', 'тестировщик') to canonical role ID.
 */
export function normalizeRoleId(input, availableRoles = []) {
  if (!input || typeof input !== 'string') return 'architecture'
  const lower = input.trim().toLowerCase()

  const rolesList = toRolesArray(
    availableRoles && (Array.isArray(availableRoles) ? availableRoles.length > 0 : Object.keys(availableRoles).length > 0)
      ? availableRoles
      : getDefaultRoles()
  )

  for (const role of rolesList) {
    if (role.id.toLowerCase() === lower) return role.id
    if (role.name && role.name.toLowerCase() === lower) return role.id
    if (role.displayName && role.displayName.toLowerCase() === lower) return role.id
  }

  const aliasMap = {
    coder: 'code',
    developer: 'code',
    dev: 'code',
    разработчик: 'code',
    программист: 'code',
    код: 'code',

    reviewer: 'qa_tests',
    review: 'qa_tests',
    ревью: 'qa_tests',
    ревьюер: 'qa_tests',
    tester: 'qa_tests',
    qa: 'qa_tests',
    тестировщик: 'qa_tests',
    тесты: 'qa_tests',

    architect: 'architecture',
    архитектор: 'architecture',
    архитектура: 'architecture',
    design_system: 'architecture',

    writer: 'docs',
    technical_writer: 'docs',
    документация: 'docs',
    документатор: 'docs',
    доки: 'docs',

    spec: 'spec',
    тз: 'spec',
    спецификация: 'spec',
    analyst: 'spec',

    // Frontend
    frontend: 'frontend',
    front: 'frontend',
    фронтенд: 'frontend',
    фронт: 'frontend',

    // Backend
    backend: 'backend',
    back: 'backend',
    бэкенд: 'backend',
    бэк: 'backend',

    designer: 'ui_design',
    design: 'ui_design',
    дизайнер: 'ui_design',
    дизайн: 'ui_design',
    ux: 'ui_design',
    ui: 'ui_design',
  }

  for (const [alias, id] of Object.entries(aliasMap)) {
    if (lower === alias || lower.includes(alias)) {
      const found = rolesList.find((r) => r.id === id)
      if (found) return found.id
    }
  }

  return 'architecture' // Safe fallback role
}

/**
 * Extracts plain text from canonical DSH subagent output block array.
 */
function extractOutputText(output) {
  if (!output) return ''
  if (typeof output === 'string') return output
  if (Array.isArray(output)) {
    return output
      .map((block) => {
        if (typeof block === 'string') return block
        if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
          return block.text
        }
        return ''
      })
      .join('')
  }
  if (typeof output === 'object') {
    return output.text || output.content || JSON.stringify(output)
  }
  return String(output)
}

/**
 * Computes the delegation nesting depth based on parent context or session metadata.
 *
 * @param {object} [execCtx]
 * @param {number} [explicitDepth]
 * @returns {number} Current delegation depth (root = 0, child = 1)
 */
export function computeDelegationDepth(execCtx, explicitDepth) {
  if (typeof explicitDepth === 'number') return explicitDepth
  if (typeof execCtx?.depth === 'number') return execCtx.depth
  if (typeof execCtx?.session?.metadata?.delegationDepth === 'number') {
    return execCtx.session.metadata.delegationDepth
  }
  if (execCtx?.session?.parentId || execCtx?.session?.parent) {
    return 1
  }
  return 0
}

/**
 * Executes delegation to a specialist worker with security guardrails.
 *
 * @param {object} params
 * @param {string} params.roleId Target specialist role ID or alias
 * @param {string} params.task Detailed task description for the specialist
 * @param {string} [params.mode='one-shot'] Execution mode: 'one-shot' or 'continuable'
 * @param {string} [params.cwd] Working directory scoping for the specialist
 * @param {string} [params.context] Existing files, code, or background context
 * @param {Array<object>|object} [params.roles] Available roles list or dict
 * @param {object} [params.config] Plugin config
 * @param {function} [params.callLlm] Direct LLM caller
 * @param {object} [params.subagents] Native DSH subagents service (ctx.subagents)
 * @param {Array<string|object>} [params.parentTools] Host/parent tools for security intersection
 * @param {string} [params.parentSessionId] Current DSH session ID for child session linking
 * @param {number} [params.currentDepth=0] Current recursion depth of caller
 * @param {boolean} [params.isChildSession=false] Whether caller is already a delegated child
 * @param {Array<object>} [params.allowedRoutes] Authorized models from subagent-model-selection
 * @param {object} [params.serializationGate] Concurrency and serialization gate
 * @param {object} [params.sessionLifecycle] Lifecycle manager for subagent sessions
 * @param {function} [params.onStreamDelta] Streaming callback
 * @param {AbortSignal} [params.signal] Cancellation abort signal
 * @returns {Promise<object>} Result deliverable
 */
export async function executeDirectDelegation({
  roleId,
  task,
  mode = 'one-shot',
  cwd,
  context = '',
  roles = [],
  config = {},
  callLlm,
  subagents,
  parentTools,
  parentSessionId = 'root',
  currentDepth = 0,
  isChildSession = false,
  allowedRoutes,
  serializationGate,
  sessionLifecycle,
  onStreamDelta,
  signal,
}) {
  const startTime = Date.now()

  // 0. Anti-Matryoshka & Anti-Redelegation Depth Guardrails (Issues #19, #102, #103)
  const isNested = isChildSession || currentDepth > 0

  // Check 1: Nested delegation disabled by policy
  if (config.disableNestedDelegation && isNested) {
    throw new Error(`[DelegationGuard] ${NESTED_DELEGATION_GUARD_MESSAGE}`)
  }

  // Check 2: Hard ceiling on delegation depth (HARD_MAX_DEPTH = 3)
  if (currentDepth >= HARD_MAX_DEPTH) {
    throw new Error(`[DelegationGuard] ${DELEGATION_DEPTH_LIMIT_MESSAGE}`)
  }

  // 1. Workspace Scoping & Sandbox Containment (Issue #87)
  const scopedCwd = cwd ? resolveScopedCwd(cwd, config.baseDir || process.cwd()) : undefined

  const allRoles = toRolesArray(
    roles && (Array.isArray(roles) ? roles.length > 0 : Object.keys(roles).length > 0)
      ? roles
      : getDefaultRoles()
  )
  const canonicalId = normalizeRoleId(roleId, allRoles)
  const role = allRoles.find((r) => r.id === canonicalId) || allRoles[0]
  const roleName = role.displayName || role.name || role.id

  const executionId = `delegation-${randomUUID().slice(0, 8)}`

  // 2. Concurrency & Serialization Gate Acquisition (Issue #93)
  let releaseGateSlot = () => {}
  if (serializationGate && typeof serializationGate.acquire === 'function') {
    releaseGateSlot = await serializationGate.acquire(parentSessionId || 'root', executionId)
  }

  try {
    // 3. Calculate Tool Intersection & Adaptive Sanitization (Issues #2, #103, #111)
    const hasContext = Boolean(context && String(context).trim() !== '')
    const intersection = resolveToolIntersection({
      parentTools,
      roleTools: role.tools,
      denyList: config.deniedTools || [],
      failLoud: parentTools !== undefined && !hasContext,
      roleId: role.id,
    })

    // 4. Model resolution: Smart Model Routing (#48) & Fail-Fast Candidate Shortlist (#82)
    const { provider, model, warning, candidateShortlist, selectionReason } = resolveSpecialistModel({
      roleModel: role.defaultModel,
      fallbackModel: { provider: 'deepseek', model: 'deepseek-chat' },
      allowedRoutes,
      roleId: role.id,
      task,
      smartRoutingEnabled: Boolean(config.smartModelRouting),
      allowedProviders: config.allowedProviders || [],
      registryProviders: config.registryProviders || [],
      failFast: Boolean(config.failFastModelValidation),
    })

    if (warning) {
      console.warn(`[dsh-agent-orchestrator] ${warning}`)
    }

    const temperature = role.temperature ?? 0.3
    const maxTokens = role.maxTokens ?? 4096

    // Helper to produce standard result deliverable with Decision Trace Ledger (Issue #108)
    const produceDeliverable = (data) => {
      const durationMs = Date.now() - startTime
      const decisionTrace = createDecisionTrace({
        executionId,
        roleId: role.id,
        roleName,
        requestedModel: role.defaultModel?.model,
        assignedModel: `${provider}:${model}`,
        selectionReason: selectionReason || (warning ? 'fallback_allowed' : 'preset_match'),
        toolSummary: {
          allowed: intersection.tools,
          strippedSecurity: intersection.droppedTools,
        },
        droppedTools: intersection.droppedTools,
        depth: currentDepth + 1,
        durationMs,
        status: data.status || 'completed',
        rationale: `Delegated to [${roleName}] with ${intersection.tools.length} allowed tools`,
      })

      return {
        ...data,
        cwd: scopedCwd,
        candidateShortlist: candidateShortlist?.length ? candidateShortlist : undefined,
        decisionTrace,
        presentationMeta: {
          decisionTrace,
        },
      }
    }

    // 5. Check for Native DSH subagent service (Issues #3, #110, #56, #75)
    if (subagents && typeof subagents.getProvider === 'function') {
      const subagentProviderName = config.subagentProvider || 'spawn'
      const transport = subagents.getProvider(subagentProviderName)

      if (transport) {
        const isContinuable = mode === 'continuable' && typeof subagents.startContinuable === 'function'

        // Leaf Experts Guard: maxDepth is capped at 1 for leaf subagents (Issue #102)
        const subagentRequest = {
          label: `[${roleName}] ${task.slice(0, 48)}`,
          prompt: [{ type: 'text', text: task }],
          parent: parentSessionId,
          persona: role.systemPrompt,
          toolFilter: { allow: intersection.tools },
          approval: 'never', // Pinned Non-Interactive Approvals (Issue #110)
          maxDepth: 1, // Leaf expert bound: cannot spawn nested agents (Issue #102)
          metadata: {
            delegationDepth: currentDepth + 1,
            roleId: role.id,
            isLeaf: true,
          },
          ...(scopedCwd ? { cwd: scopedCwd } : {}),
          agentOptions: {
            provider,
            model,
            maxTokens,
            temperature,
          },
        }

        if (isContinuable) {
          const continuableResult = await subagents.startContinuable({
            provider: subagentProviderName,
            label: subagentRequest.label,
            request: subagentRequest,
            signal,
          })
          const childId = continuableResult.childId || continuableResult.id
          if (sessionLifecycle && childId) {
            sessionLifecycle.register(childId, {
              roleId: role.id,
              executionId,
              mode: 'continuable',
              parentSessionId,
            })
          }

          return produceDeliverable({
            kind: 'continuable',
            childSessionId: childId,
            executionId,
            roleId: role.id,
            roleName,
            model: `${provider}:${model}`,
            toolDiff: intersection.diff,
            droppedTools: intersection.droppedTools,
            depth: currentDepth + 1,
            status: 'running',
            output: `Continuable child session started: ${childId}`,
          })
        }

        // Foreground / one-shot subagent execution with Deterministic max-tokens Watchdog (#75)
        let outputText = ''
        let runResult = null
        let finalStopReason = 'completed'
        let capturedChildSessionId = null

        const executeForegroundTurn = async (count, contPrompt) => {
          const activePrompt = count === 0 ? task : contPrompt
          const run = await subagents.start(subagentProviderName, {
            ...subagentRequest,
            prompt: [{ type: 'text', text: activePrompt }],
            signal,
          })

          if (run?.id && !capturedChildSessionId) {
            capturedChildSessionId = run.id
          }

          if (sessionLifecycle && run?.id) {
            sessionLifecycle.register(run.id, {
              roleId: role.id,
              executionId,
              mode: 'one-shot',
              parentSessionId,
            })
          }

          try {
            runResult = await run.result
          } finally {
            if (run && typeof run.dispose === 'function') {
              await run.dispose().catch((err) => {
                console.debug('[dsh-agent-orchestrator] run.dispose skipped:', err?.message || err)
              })
            }
            if (sessionLifecycle && run?.id) {
              sessionLifecycle.markCompleted(run.id, {
                roleId: role.id,
                stopReason: runResult?.stopReason,
              })
            }
          }

          finalStopReason = runResult?.stopReason || 'completed'
          return {
            output: extractOutputText(runResult?.output),
            stopReason: finalStopReason,
          }
        }

        const watchdogResult = await runWithMaxTokensWatchdog({
          executionId,
          executeTurn: executeForegroundTurn,
        })
        outputText = watchdogResult.output

        return produceDeliverable({
          kind: 'foreground',
          childSessionId: capturedChildSessionId || executionId,
          executionId,
          roleId: role.id,
          roleName,
          model: `${provider}:${model}`,
          toolDiff: intersection.diff,
          droppedTools: intersection.droppedTools,
          depth: currentDepth + 1,
          status: watchdogResult.stopReason,
          output: outputText,
          metrics: {
            model: `${provider}:${model}`,
            roleId: role.id,
            executionId,
            depth: currentDepth + 1,
            stopReason: watchdogResult.stopReason,
            continuations: watchdogResult.continuationCount,
          },
        })
      }
    }

    // 6. Fallback: Direct LLM Turn with Prompt Cache Alignment & Watchdog (Issue #75)
    if (typeof callLlm !== 'function') {
      throw new Error('Neither subagents transport nor callLlm function is available for delegation')
    }

    const baseAnchor = buildStaticBaseAnchor({
      projectType: config.projectType || 'dsh-plugin',
      customRules: config.customRules || '',
    })

    const taskAnchor = buildSharedTaskAnchor({
      id: executionId,
      title: `Direct Delegation: ${roleName}`,
      description: task,
      repo: config.repo || 'active-workspace',
      scenario: 'direct-delegation',
    })

    const upstreamArtifacts = context
      ? formatCumulativeArtifacts([
          {
            stageId: 'user-context',
            roleId: 'parent-agent',
            output: context,
          },
        ])
      : ''

    const stage = {
      id: executionId,
      name: `Direct Delegation to ${roleName}`,
      roleId: role.id,
      prompt: task,
    }

    const messages = assembleAgentMessages({
      baseAnchor,
      taskAnchor,
      cumulativeArtifacts: upstreamArtifacts,
      agentRole: role,
      currentStage: stage,
    })

    let lastUsage = {}
    const executeLlmTurn = async (count, contPrompt) => {
      const turnMessages = count === 0
        ? messages
        : [
            ...messages,
            { role: 'user', content: contPrompt }
          ]

      const res = await callWithTransientRetry(
        callLlm,
        {
          provider,
          model,
          messages: turnMessages,
          temperature,
          maxTokens,
          onStreamDelta,
        },
        2,
        1200
      )
      lastUsage = res.usage || {}
      return {
        output: res.text || res.content || '',
        stopReason: res.stopReason || res.finishReason || 'completed',
      }
    }

    const watchdogResult = await runWithMaxTokensWatchdog({
      executionId,
      executeTurn: executeLlmTurn,
    })

    const cacheMetrics = extractCacheMetrics(lastUsage)

    return produceDeliverable({
      kind: 'inline',
      output: watchdogResult.output,
      roleId: role.id,
      roleName,
      model: `${provider}:${model}`,
      toolDiff: intersection.diff,
      droppedTools: intersection.droppedTools,
      depth: currentDepth + 1,
      status: watchdogResult.stopReason,
      metrics: {
        ...cacheMetrics,
        model: `${provider}:${model}`,
        roleId: role.id,
        executionId,
        depth: currentDepth + 1,
        continuations: watchdogResult.continuationCount,
      },
    })
  } finally {
    releaseGateSlot()
  }
}
