/**
 * Model Pool, Smart Routing, and Validation Helper for Multi-Agent Orchestrator.
 *
 * Implements:
 * 1. Subagent Model Selection settings integration (`subagent-model-selection`).
 * 2. Fail-Fast Model Validation with Candidate Shortlist (Issue #82):
 *    - Validates requested model against available provider registry.
 *    - Suggests compact shortlist of available candidates on mismatch.
 * 3. Smart Model Routing by Task Type and Complexity (Issue #48):
 *    - Automatically maps light vs reasoning tasks to optimal models when enabled.
 *    - Respects `allowedProviders` whitelist.
 *    - Gracefully falls back to default base model on failure or disabled state.
 */

export class ModelValidationError extends Error {
  constructor(message, { requestedProvider, requestedModel, candidateShortlist = [] } = {}) {
    super(message)
    this.name = 'ModelValidationError'
    this.requestedProvider = requestedProvider
    this.requestedModel = requestedModel
    this.candidateShortlist = candidateShortlist
  }
}

/**
 * Task complexity tier classifications.
 */
export const TASK_TIERS = {
  LIGHT: 'light',
  BALANCED: 'balanced',
  REASONING: 'reasoning',
}

/**
 * Keywords indicating reasoning-heavy analytical tasks.
 */
const REASONING_KEYWORDS = [
  'architecture', 'архитектур', 'design_system', 'security', 'безопасност',
  'audit', 'аудит', 'vulnerability', 'уязвимост', 'refactor', 'рефакторинг',
  'algorithm', 'алгоритм', 'deadlock', 'race condition', 'оптимизаци'
]

/**
 * Keywords indicating light computational tasks.
 */
const LIGHT_KEYWORDS = [
  'format', 'формат', 'lint', 'линт', 'docs', 'документаци', 'readme',
  'find', 'поиск', 'grep', 'scan', 'сканирован', 'rename', 'переименов'
]

/**
 * Infer task complexity tier based on role and task text.
 *
 * @param {string} roleId
 * @param {string} taskText
 * @returns {'light'|'balanced'|'reasoning'}
 */
export function inferTaskComplexityTier(roleId = '', taskText = '') {
  const r = String(roleId).toLowerCase()
  const t = String(taskText).toLowerCase()

  if (r === 'architecture' || r === 'security_audit' || r === 'dba') {
    return TASK_TIERS.REASONING
  }
  if (r === 'docs' || r === 'technical_writer') {
    return TASK_TIERS.LIGHT
  }

  const isReasoning = REASONING_KEYWORDS.some((kw) => t.includes(kw))
  if (isReasoning) return TASK_TIERS.REASONING

  const isLight = LIGHT_KEYWORDS.some((kw) => t.includes(kw))
  if (isLight) return TASK_TIERS.LIGHT

  return TASK_TIERS.BALANCED
}

/**
 * Reads the official `subagent-model-selection` configuration from DSH settings.
 *
 * @param {object} ctx Cordis context
 * @returns {{ sectionPresent: boolean, allowedRoutes?: Array<{ provider: string, model: string }> }}
 */
export function readModelSelection(ctx) {
  if (!ctx || !ctx.settings || typeof ctx.settings.get !== 'function') {
    return { sectionPresent: false, allowedRoutes: undefined }
  }

  try {
    const selection = ctx.settings.get('subagent-model-selection')
    if (!selection || typeof selection !== 'object') {
      return { sectionPresent: false, allowedRoutes: undefined }
    }

    const models = Array.isArray(selection.allowedModels)
      ? selection.allowedModels.filter(
          (m) => m && typeof m.provider === 'string' && typeof m.model === 'string'
        )
      : []

    return {
      sectionPresent: true,
      allowedRoutes: selection.enabled === true && models.length > 0 ? models : undefined,
    }
  } catch {
    return { sectionPresent: false, allowedRoutes: undefined }
  }
}

/**
 * Checks whether a given provider and model pair is in the allowed list.
 *
 * @param {{ provider: string, model: string }} route
 * @param {Array<{ provider: string, model: string }>} [allowedRoutes]
 * @returns {boolean}
 */
export function isRouteAllowed(route, allowedRoutes) {
  if (!allowedRoutes || allowedRoutes.length === 0) return true
  if (!route || !route.provider || !route.model) return false
  return allowedRoutes.some((m) => m.provider === route.provider && m.model === route.model)
}

/**
 * Validates a model against provider registry with Candidate Shortlist (Issue #82).
 *
 * @param {object} params
 * @param {string} params.provider Requested provider ID
 * @param {string} params.model Requested model ID
 * @param {Array<object>} [params.registryProviders=[]] Available providers from ctx.llm.listProviders()
 * @param {boolean} [params.failFast=false] Throw ModelValidationError on failure
 * @returns {{ valid: boolean, candidateShortlist: string[], resolvedModel?: string, warning?: string }}
 */
export function validateModelCandidate({
  provider,
  model,
  registryProviders = [],
  failFast = false,
}) {
  if (!registryProviders || registryProviders.length === 0) {
    return { valid: true, candidateShortlist: [] }
  }

  const prov = registryProviders.find(
    (p) => p.id === provider || (provider === 'deepseek' && p.id === 'deepseek-official')
  )

  if (!prov) {
    const allProviders = registryProviders.map((p) => p.id)
    const err = new ModelValidationError(
      `[ModelValidation] Provider "${provider}" not found. Available providers: [${allProviders.join(', ')}]`,
      { requestedProvider: provider, requestedModel: model, candidateShortlist: allProviders }
    )
    if (failFast) throw err
    return { valid: false, candidateShortlist: allProviders, warning: err.message }
  }

  const availableModels = Array.isArray(prov.models)
    ? prov.models.map((m) => (typeof m === 'string' ? m : m?.id || m?.name)).filter(Boolean)
    : []

  if (availableModels.length === 0) {
    return { valid: true, candidateShortlist: [] }
  }

  // Exact match
  if (availableModels.includes(model)) {
    return { valid: true, candidateShortlist: availableModels, resolvedModel: model }
  }

  // Fuzzy / case-insensitive match
  const lowerModel = model.toLowerCase()
  const match = availableModels.find((m) => m.toLowerCase() === lowerModel)
  if (match) {
    return { valid: true, candidateShortlist: availableModels, resolvedModel: match }
  }

  const err = new ModelValidationError(
    `[ModelValidation] Model "${model}" not found for provider "${provider}". Available candidates: [${availableModels.join(', ')}]`,
    { requestedProvider: provider, requestedModel: model, candidateShortlist: availableModels }
  )

  if (failFast) {
    throw err
  }

  return {
    valid: false,
    candidateShortlist: availableModels,
    suggestedModel: availableModels[0],
    warning: err.message,
  }
}

/**
 * Smart Model Router (Issue #48).
 * Selects optimal model tier depending on task complexity while respecting allowedProviders whitelist.
 *
 * @param {object} params
 * @param {string} params.roleId
 * @param {string} params.task
 * @param {object} params.baseModel Default fallback model { provider, model }
 * @param {boolean} [params.enabled=false]
 * @param {Array<string>} [params.allowedProviders=[]]
 * @param {object} [params.tierModels] Custom model mappings per tier
 * @returns {{ provider: string, model: string, tier: string, reason: string }}
 */
export function resolveSmartModel({
  roleId,
  task,
  baseModel = { provider: 'deepseek-official', model: 'deepseek-chat' },
  enabled = false,
  allowedProviders = [],
  tierModels = {},
}) {
  if (!enabled) {
    return {
      provider: baseModel.provider,
      model: baseModel.model,
      tier: 'default',
      reason: 'smart_routing_disabled',
    }
  }

  const tier = inferTaskComplexityTier(roleId, task)

  // Default tier routing presets
  const defaults = {
    [TASK_TIERS.LIGHT]: { provider: 'deepseek-official', model: 'deepseek-chat' },
    [TASK_TIERS.BALANCED]: { provider: 'deepseek-official', model: 'deepseek-chat' },
    [TASK_TIERS.REASONING]: { provider: 'deepseek-official', model: 'deepseek-reasoner' },
  }

  const candidate = tierModels[tier] || defaults[tier] || baseModel

  // Validate against allowedProviders whitelist if set
  if (Array.isArray(allowedProviders) && allowedProviders.length > 0) {
    if (!allowedProviders.includes(candidate.provider)) {
      return {
        provider: baseModel.provider,
        model: baseModel.model,
        tier: 'fallback',
        reason: `provider_${candidate.provider}_not_in_allowedProviders`,
      }
    }
  }

  return {
    provider: candidate.provider,
    model: candidate.model,
    tier,
    reason: `smart_route_${tier}`,
  }
}

/**
 * Resolves the appropriate model for a specialist execution.
 * Combines role binding, smart routing (Issue #48), Candidate Shortlist check (Issue #82),
 * and DSH allowedRoutes security policy.
 *
 * @param {object} params
 * @param {object} [params.roleModel] Model assigned to the role
 * @param {object} [params.fallbackModel] Fallback default model
 * @param {Array<{ provider: string, model: string }>} [params.allowedRoutes]
 * @param {string} [params.roleId]
 * @param {string} [params.task]
 * @param {boolean} [params.smartRoutingEnabled=false]
 * @param {Array<string>} [params.allowedProviders=[]]
 * @param {Array<object>} [params.registryProviders=[]]
 * @param {boolean} [params.failFast=false]
 * @returns {{ provider: string, model: string, warning?: string, candidateShortlist?: string[], selectionReason: string }}
 */
export function resolveSpecialistModel({
  roleModel,
  fallbackModel,
  allowedRoutes,
  roleId,
  task,
  smartRoutingEnabled = false,
  allowedProviders = [],
  registryProviders = [],
  failFast = false,
}) {
  const defaultFallback = fallbackModel || { provider: 'deepseek-official', model: 'deepseek-chat' }
  let targetModel = roleModel || defaultFallback
  let selectionReason = roleModel ? 'role_preset' : 'default_fallback'

  // 1. Smart Model Routing (Issue #48)
  if (smartRoutingEnabled && task) {
    const smart = resolveSmartModel({
      roleId,
      task,
      baseModel: targetModel,
      enabled: true,
      allowedProviders,
    })
    targetModel = { provider: smart.provider, model: smart.model }
    selectionReason = smart.reason
  }

  // 2. Candidate Shortlist Validation (Issue #82)
  let candidateShortlist = []
  let warning
  if (registryProviders && registryProviders.length > 0) {
    const validation = validateModelCandidate({
      provider: targetModel.provider,
      model: targetModel.model,
      registryProviders,
      failFast,
    })
    candidateShortlist = validation.candidateShortlist

    if (!validation.valid) {
      warning = validation.warning
      if (validation.suggestedModel) {
        targetModel.model = validation.suggestedModel
        selectionReason = 'candidate_shortlist_fallback'
      }
    } else if (validation.resolvedModel) {
      targetModel.model = validation.resolvedModel
    }
  }

  // 3. Official subagent-model-selection allowedRoutes constraint
  if (allowedRoutes && allowedRoutes.length > 0) {
    if (!isRouteAllowed(targetModel, allowedRoutes)) {
      const safeFallback = allowedRoutes[0]
      warning = `Model ${targetModel.provider}:${targetModel.model} is not in subagent-model-selection.allowedModels; fell back to ${safeFallback.provider}:${safeFallback.model}`
      return {
        provider: safeFallback.provider,
        model: safeFallback.model,
        warning,
        candidateShortlist,
        selectionReason: 'allowed_routes_fallback',
      }
    }
  }

  return {
    provider: targetModel.provider,
    model: targetModel.model,
    warning,
    candidateShortlist,
    selectionReason,
  }
}
