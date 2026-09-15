/**
 * Direct Specialist Subagent Delegation Runner.
 *
 * Provides on-demand delegation to any of the 12 specialized roles:
 * - Architecture, Spec, UI Design, Frontend, Backend, QA Tests,
 *   Code Review, Security Audit, DevOps, Docs, Data Engineer, DBA.
 * - Integrates with DSH native ctx.subagents seam (spawn / continuable child sessions).
 * - Enforces Tool Intersection security: (roleTools ∩ parentTools) \ {run_code} \ denyList.
 * - Enforces Pinned Non-Interactive Approvals: approval: 'never' to prevent deadlocks.
 * - Supports per-call cwd scoping for isolated workspace execution.
 * - Leverages L1 (>1024 token) + L2 Prompt Caching anchors when running direct LLM turns.
 */

import { randomUUID } from 'crypto'
import {
  buildStaticBaseAnchor,
  buildSharedTaskAnchor,
  formatCumulativeArtifacts,
  assembleAgentMessages,
  extractCacheMetrics,
} from './cache-prefixer.js'
import { callWithTransientRetry } from './worker-pool.js'
import { resolveSpecialistModel } from './model-selection.js'
import { getDefaultRoles } from './scenarios.js'
import { resolveToolIntersection } from './intersection.js'

/**
 * Converts roles parameter (dictionary or array) into a unified array of role objects.
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
 * Normalizes user-specified or LLM-specified role identifiers.
 * Maps common Russian and English aliases to canonical role IDs.
 */
export function normalizeRoleId(input, availableRoles = []) {
  if (!input || typeof input !== 'string') return 'architecture'

  const rolesList = toRolesArray(availableRoles)
  const lower = input.trim().toLowerCase()
  const exact = rolesList.find((r) => (r.id || '').toLowerCase() === lower)
  if (exact) return exact.id

  const byDisplay = rolesList.find(
    (r) =>
      (r.displayName || '').toLowerCase() === lower ||
      (r.name || '').toLowerCase() === lower
  )
  if (byDisplay) return byDisplay.id

  // Alias dictionary
  const aliasMap = {
    // Architecture
    arch: 'architecture',
    architect: 'architecture',
    архитектор: 'architecture',
    архитектура: 'architecture',
    // Spec
    specification: 'spec',
    спецификация: 'spec',
    аналитик: 'spec',
    // UI Design
    ui: 'ui_design',
    design: 'ui_design',
    designer: 'ui_design',
    дизайн: 'ui_design',
    дизайнер: 'ui_design',
    // Frontend
    front: 'frontend',
    фронт: 'frontend',
    фронтенд: 'frontend',
    фронтендер: 'frontend',
    // Backend
    back: 'backend',
    бэк: 'backend',
    бэкенд: 'backend',
    бэкендер: 'backend',
    // QA / Tests
    qa: 'qa_tests',
    test: 'qa_tests',
    tester: 'qa_tests',
    тестировщик: 'qa_tests',
    тесты: 'qa_tests',
    // Code Review
    review: 'refactoring',
    reviewer: 'refactoring',
    ревью: 'refactoring',
    // Bugfix
    bugfix: 'bugfix',
    баг: 'bugfix',
    // DevOps
    ops: 'devops',
    девопс: 'devops',
    // Docs
    doc: 'docs',
    documentation: 'docs',
    документация: 'docs',
    дока: 'docs',
    // Research
    research: 'research',
    исследование: 'research',
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
 * Executes delegation to a specialist worker.
 *
 * Supports both:
 * 1. Native DSH subagents lifecycle via `subagents` service (spawn/continuable child sessions)
 * 2. Direct LLM execution with Prompt Caching when subagents service is not present.
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
 * @param {Array<object>} [params.allowedRoutes] Authorized models from subagent-model-selection
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
  parentSessionId,
  allowedRoutes,
  onStreamDelta,
  signal,
}) {
  const allRoles = toRolesArray(
    roles && (Array.isArray(roles) ? roles.length > 0 : Object.keys(roles).length > 0)
      ? roles
      : getDefaultRoles()
  )
  const canonicalId = normalizeRoleId(roleId, allRoles)
  const role = allRoles.find((r) => r.id === canonicalId) || allRoles[0]
  const roleName = role.displayName || role.name || role.id

  const executionId = `delegation-${randomUUID().slice(0, 8)}`

  // 1. Calculate Tool Intersection & Security Narrowing (Issue #2 & #103)
  const intersection = resolveToolIntersection({
    parentTools,
    roleTools: role.tools,
    denyList: config.deniedTools || [],
    failLoud: parentTools !== undefined,
    roleId: role.id,
  })

  // 2. Model resolution with allowedRoutes constraint
  const { provider, model, warning } = resolveSpecialistModel({
    roleModel: role.defaultModel,
    fallbackModel: { provider: 'deepseek', model: 'deepseek-chat' },
    allowedRoutes,
  })

  if (warning) {
    console.warn(`[dsh-agent-orchestrator] ${warning}`)
  }

  const temperature = role.temperature ?? 0.3
  const maxTokens = role.maxTokens ?? 4096

  // 3. Check for Native DSH subagent service (Issue #3 & #110)
  if (subagents && typeof subagents.getProvider === 'function') {
    const subagentProviderName = config.subagentProvider || 'spawn'
    const transport = subagents.getProvider(subagentProviderName)

    if (transport) {
      const isContinuable = mode === 'continuable' && typeof subagents.startContinuable === 'function'

      const subagentRequest = {
        label: `[${roleName}] ${task.slice(0, 48)}`,
        prompt: [{ type: 'text', text: task }],
        parent: parentSessionId,
        persona: role.systemPrompt,
        toolFilter: { allow: intersection.tools },
        approval: 'never', // Pinned Non-Interactive Approvals (Issue #110)
        ...(cwd ? { cwd } : {}),
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
        return {
          kind: 'continuable',
          childSessionId: continuableResult.childId || continuableResult.id,
          executionId,
          roleId: role.id,
          roleName,
          model: `${provider}:${model}`,
          toolDiff: intersection.diff,
          status: 'running',
          output: `Continuable child session started: ${continuableResult.childId || continuableResult.id}`,
        }
      }

      // Foreground / one-shot subagent execution
      const run = await subagents.start(subagentProviderName, {
        ...subagentRequest,
        signal,
      })

      let runResult
      try {
        runResult = await run.result
      } finally {
        if (run && typeof run.dispose === 'function') {
          await run.dispose().catch(() => {})
        }
      }

      const outputText = extractOutputText(runResult?.output)
      return {
        kind: 'foreground',
        childSessionId: run.id,
        executionId,
        roleId: role.id,
        roleName,
        model: `${provider}:${model}`,
        toolDiff: intersection.diff,
        status: runResult?.stopReason || 'completed',
        output: outputText,
        metrics: {
          model: `${provider}:${model}`,
          roleId: role.id,
          executionId,
          stopReason: runResult?.stopReason,
        },
      }
    }
  }

  // 4. Fallback: Direct LLM Turn with Prompt Cache Alignment (when native subagents service is absent)
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

  const result = await callWithTransientRetry(
    callLlm,
    {
      provider,
      model,
      messages,
      temperature,
      maxTokens,
      onStreamDelta,
    },
    2,
    1200
  )

  const outputText = result.text || result.content || ''
  const rawUsage = result.usage || {}
  const cacheMetrics = extractCacheMetrics(rawUsage)

  return {
    kind: 'inline',
    output: outputText,
    roleId: role.id,
    roleName,
    model: `${provider}:${model}`,
    toolDiff: intersection.diff,
    status: 'completed',
    metrics: {
      ...cacheMetrics,
      model: `${provider}:${model}`,
      roleId: role.id,
      executionId,
    },
  }
}
