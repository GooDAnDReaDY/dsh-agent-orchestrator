/**
 * Direct Specialist Subagent Delegation Runner.
 *
 * Provides on-demand delegation to any of the 12 specialized roles:
 * - Architecture, Spec, UI Design, Frontend, Backend, QA Tests,
 *   Code Review, Security Audit, DevOps, Docs, Data Engineer, DBA.
 * - Enforces Strict Separation of Duties (Frontend/Design vs Backend).
 * - Leverages L1 (>1024 token) + L2 Prompt Caching anchors.
 * - Resolves models against authorized subagent-model-selection pool.
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
 * Executes a direct delegation to a specialized role.
 *
 * @param {object} params
 * @param {string} params.roleId Target specialist role ID or alias
 * @param {string} params.task Detailed task description for the specialist
 * @param {string} [params.context] Existing files, code, or background context
 * @param {Array<object>|object} [params.roles] Available roles list or dict
 * @param {object} [params.config] Plugin config
 * @param {function} params.callLlm Unified LLM caller
 * @param {Array<object>} [params.allowedRoutes] Authorized models from subagent-model-selection
 * @param {function} [params.onStreamDelta] Streaming callback
 * @returns {Promise<{ output: string, roleId: string, roleName: string, model: string, metrics: object }>}
 */
export async function executeDirectDelegation({
  roleId,
  task,
  context = '',
  roles = [],
  config = {},
  callLlm,
  allowedRoutes,
  onStreamDelta,
}) {
  if (typeof callLlm !== 'function') {
    throw new Error('callLlm function is required for subagent delegation')
  }

  const allRoles = toRolesArray(
    roles && (Array.isArray(roles) ? roles.length > 0 : Object.keys(roles).length > 0)
      ? roles
      : getDefaultRoles()
  )
  const canonicalId = normalizeRoleId(roleId, allRoles)
  const role = allRoles.find((r) => r.id === canonicalId) || allRoles[0]
  const roleName = role.displayName || role.name || role.id

  const executionId = `delegation-${randomUUID().slice(0, 8)}`

  // 1. Layer 1: Static Base Anchor (> 1024 tokens for KV-cache reuse)
  const baseAnchor = buildStaticBaseAnchor({
    projectType: config.projectType || 'dsh-plugin',
    customRules: config.customRules || '',
  })

  // 2. Layer 2: Direct Task Anchor
  const taskAnchor = buildSharedTaskAnchor({
    id: executionId,
    title: `Direct Delegation: ${roleName}`,
    description: task,
    repo: config.repo || 'active-workspace',
    scenario: 'direct-delegation',
  })

  // 3. Layer 3: Context / Background Material
  const upstreamArtifacts = context
    ? formatCumulativeArtifacts([
        {
          stageId: 'user-context',
          roleId: 'parent-agent',
          output: context,
        },
      ])
    : ''

  // 4. Assemble canonical prompt (Layers 1-3 in System, Layer 4 Role + Task in User)
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

  // 5. Model resolution with allowedRoutes constraint
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

  // 6. Execute LLM call with transient retry
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
    output: outputText,
    roleId: role.id,
    roleName,
    model: `${provider}:${model}`,
    metrics: {
      ...cacheMetrics,
      model: `${provider}:${model}`,
      roleId: role.id,
      executionId,
    },
  }
}
