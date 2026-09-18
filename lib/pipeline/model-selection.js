/**
 * Model Pool, Smart Routing, Dynamic Catalog, and Validation Helper for Multi-Agent Orchestrator.
 *
 * Implements:
 * 1. Subagent Model Selection settings integration (`subagent-model-selection`).
 * 2. Fail-Fast Model Validation with Candidate Shortlist (Issue #82).
 * 3. Smart Model Routing by Task Type and Complexity (Issue #48).
 * 4. Dynamic Provider & Model Catalog Discovery (`model_subagent_catalog`) (Issue #76).
 * 5. Semantic Capability Tags (coding, reasoning, fast, general) (Issue #74).
 * 6. Granular maxTokens ceiling per model route (Issue #79).
 * 7. Reasoning Effort control (off, low, medium, high, max) with compatibility check (Issue #86).
 * 8. Model Identity Chips with friendly aliases (Issue #73).
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
 * Semantic Model Capabilities (Issue #74).
 */
export const MODEL_CAPABILITIES = {
  CODING: 'coding',
  REASONING: 'reasoning',
  FAST: 'fast',
  GENERAL: 'general',
}

/**
 * Supported reasoning effort levels (Issue #86).
 */
export const REASONING_EFFORTS = ['off', 'low', 'medium', 'high', 'max']

/**
 * Default and tier-based max token boundaries (Issue #79).
 */
export const DEFAULT_MAX_TOKENS = 4096
const MAX_TOKENS_BY_CAPABILITY = {
  fast: 2048,
  general: 4096,
  coding: 8192,
  reasoning: 8192,
}

/**
 * Keywords indicating reasoning-heavy analytical tasks.
 */
const REASONING_KEYWORDS = [
  'architecture', 'design_system', 'security',
  'audit', 'vulnerability', 'refactor',
  'algorithm', 'deadlock', 'race condition'
]

/**
 * Keywords indicating light computational tasks.
 */
const LIGHT_KEYWORDS = [
  'format', 'lint', 'docs', 'readme',
  'find', 'grep', 'scan', 'rename'
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
 * Infer semantic capability tags for a given model and provider (Issue #74).
 *
 * @param {string} modelId
 * @param {string} providerId
 * @returns {string[]}
 */
export function inferModelCapabilities(modelId = '', providerId = '') {
  const m = String(modelId).toLowerCase()
  const p = String(providerId).toLowerCase()
  const caps = new Set()

  // Reasoning detection
  if (/reasoner|r1|o1|o3|thinking|cot|deep-reason/i.test(m)) {
    caps.add(MODEL_CAPABILITIES.REASONING)
    caps.add('deep-reasoning')
  }

  // Coding detection
  if (/coder|coding|code|deepseek-coder|sonnet|claude-3-5|gpt-4o|qwen.*coder/i.test(m)) {
    caps.add(MODEL_CAPABILITIES.CODING)
  }

  // Fast / lightweight detection
  if (/fast|flash|mini|haiku|turbo|8b|cheap|nano|small/i.test(m)) {
    caps.add(MODEL_CAPABILITIES.FAST)
    caps.add('fast-search')
    caps.add('cheap-lint')
  }

  // Document processing
  if (/doc|writer|translat/i.test(m)) {
    caps.add('document-processing')
  }

  if (caps.size === 0) {
    caps.add(MODEL_CAPABILITIES.GENERAL)
  }

  return Array.from(caps)
}

/**
 * Check whether reasoning effort control is supported by the target model (Issue #86).
 *
 * @param {string} provider
 * @param {string} model
 * @param {object} [modelMeta]
 * @returns {boolean}
 */
export function isReasoningEffortSupported(provider = '', model = '', modelMeta = null) {
  if (modelMeta?.reasoning?.supported !== undefined) return Boolean(modelMeta.reasoning.supported)
  if (modelMeta?.capabilities?.reasoningEffort !== undefined) return Boolean(modelMeta.capabilities.reasoningEffort)
  if (modelMeta?.reasoningEffortSupported !== undefined) return Boolean(modelMeta.reasoningEffortSupported)
  const m = String(model).toLowerCase()
  return /reasoner|r1|o1|o3|thinking|deep-reason/i.test(m)
}

/**
 * Normalize and validate reasoning effort value (Issue #86).
 *
 * @param {string} effort
 * @returns {'off'|'low'|'medium'|'high'|'max'}
 */
export function normalizeReasoningEffort(effort) {
  if (!effort || effort === 'disabled' || effort === 'off' || effort === 'none') return 'off'
  const e = String(effort).toLowerCase()
  return REASONING_EFFORTS.includes(e) ? e : 'medium'
}

/**
 * Resolve effective maxTokens ceiling for a model route (Issue #79).
 *
 * @param {object} params
 * @param {number} [params.requestedMaxTokens]
 * @param {number} [params.roleMaxTokens]
 * @param {number} [params.routeMaxTokens]
 * @param {string[]} [params.capabilities=[]]
 * @returns {number}
 */
export function resolveMaxTokens({ requestedMaxTokens, roleMaxTokens, routeMaxTokens, capabilities = [] } = {}) {
  if (typeof requestedMaxTokens === 'number' && requestedMaxTokens > 0) return requestedMaxTokens
  if (typeof roleMaxTokens === 'number' && roleMaxTokens > 0) return roleMaxTokens
  if (typeof routeMaxTokens === 'number' && routeMaxTokens > 0) return routeMaxTokens
  if (capabilities.includes('fast') || capabilities.includes('fast-search') || capabilities.includes('cheap-lint')) {
    return MAX_TOKENS_BY_CAPABILITY.fast
  }
  if (capabilities.includes('reasoning') || capabilities.includes('deep-reasoning')) {
    return MAX_TOKENS_BY_CAPABILITY.reasoning
  }
  if (capabilities.includes('coding')) {
    return MAX_TOKENS_BY_CAPABILITY.coding
  }
  if (capabilities.includes('general')) {
    return MAX_TOKENS_BY_CAPABILITY.general
  }
  return DEFAULT_MAX_TOKENS
}

/**
 * Build a structured Model Identity Chip with alias and tooltip metadata (Issue #73).
 *
 * @param {{ provider?: string, model?: string }} route
 * @param {object} [meta={}]
 * @returns {{ chipText: string, label: string, alias: string, badgeClass: string, provider: string, model: string, tooltip: string }}
 */
export function getModelIdentityChip(route = {}, meta = {}) {
  const provider = route.provider || 'default'
  const model = route.model || 'default'
  const m = String(model).toLowerCase()

  let alias = model
  let badgeClass = 'general'
  let label = 'General'

  if (/reasoner|r1/i.test(m)) {
    alias = 'R1'
    label = 'Reasoner'
    badgeClass = 'reasoner'
  } else if (/o1/i.test(m)) {
    alias = 'o1'
    label = 'Reasoner'
    badgeClass = 'reasoner'
  } else if (/o3/i.test(m)) {
    alias = 'o3'
    label = 'Reasoner'
    badgeClass = 'reasoner'
  } else if (/deepseek-chat|v3/i.test(m)) {
    alias = 'V3'
    label = 'Fast Coder'
    badgeClass = 'coder'
  } else if (/coder/i.test(m)) {
    alias = 'Coder'
    label = 'Coder'
    badgeClass = 'coder'
  } else if (/sonnet/i.test(m)) {
    alias = 'Sonnet 3.5'
    label = 'Coder'
    badgeClass = 'coder'
  } else if (/flash|mini|haiku/i.test(m)) {
    alias = m.includes('mini') ? 'Mini' : (m.includes('haiku') ? 'Haiku' : 'Flash')
    label = 'Fast'
    badgeClass = 'fast'
  } else if (/qwen/i.test(m)) {
    alias = 'Qwen'
    label = 'Local'
    badgeClass = 'local'
  }

  const chipText = `[${label} · ${alias}]`
  const maxTokens = meta.maxTokens || resolveMaxTokens({ capabilities: inferModelCapabilities(model, provider) })
  const reasoningStatus = meta.reasoningEffortSupported ?? isReasoningEffortSupported(provider, model)
  const tooltip = `${provider}:${model} (Context: ${meta.contextWindow || '64k'}, Output: ${maxTokens}, Reasoning: ${reasoningStatus ? 'Supported' : 'No'})`

  return {
    chipText,
    label,
    alias,
    badgeClass,
    provider,
    model,
    tooltip,
  }
}

/**
 * Reads the official `subagent-model-selection` configuration from DSH settings.
 *
 * @param {object} ctx Cordis context
 * @returns {{ sectionPresent: boolean, allowedRoutes?: Array<{ provider: string, model: string, maxTokens?: number }> }}
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
 * Resolves a model candidate by semantic capability requirement (Issue #74).
 *
 * @param {object} params
 * @param {string} params.capability e.g. 'coding', 'reasoning', 'fast', 'general'
 * @param {Array<object>} [params.catalog=[]]
 * @param {Array<object>} [params.allowedRoutes]
 * @param {object} [params.fallbackRoute]
 * @returns {{ provider: string, model: string, maxTokens: number, reasoningEffortSupported: boolean, capabilities: string[], selectionReason: string }}
 */
export function resolveModelByCapability({
  capability,
  catalog = [],
  allowedRoutes,
  fallbackRoute = { provider: 'deepseek-official', model: 'deepseek-chat' },
}) {
  if (!capability) {
    return {
      ...fallbackRoute,
      maxTokens: fallbackRoute.maxTokens || DEFAULT_MAX_TOKENS,
      reasoningEffortSupported: isReasoningEffortSupported(fallbackRoute.provider, fallbackRoute.model),
      capabilities: inferModelCapabilities(fallbackRoute.model, fallbackRoute.provider),
      selectionReason: 'default_fallback',
    }
  }

  const matches = catalog.filter((entry) => {
    const caps = entry.capabilities || inferModelCapabilities(entry.model, entry.provider)
    const hasCap = Array.isArray(caps) && (caps.includes(capability) || caps.includes(capability.toLowerCase()))
    if (!hasCap) return false
    return isRouteAllowed(entry, allowedRoutes)
  })

  if (matches.length > 0) {
    const candidate = matches[0]
    return {
      provider: candidate.provider,
      model: candidate.model,
      maxTokens: candidate.maxTokens || resolveMaxTokens({ capabilities: candidate.capabilities }),
      reasoningEffortSupported: candidate.reasoningEffortSupported ?? isReasoningEffortSupported(candidate.provider, candidate.model),
      capabilities: candidate.capabilities || inferModelCapabilities(candidate.model, candidate.provider),
      selectionReason: `capability_match_${capability}`,
    }
  }

  return {
    ...fallbackRoute,
    maxTokens: fallbackRoute.maxTokens || DEFAULT_MAX_TOKENS,
    reasoningEffortSupported: isReasoningEffortSupported(fallbackRoute.provider, fallbackRoute.model),
    capabilities: inferModelCapabilities(fallbackRoute.model, fallbackRoute.provider),
    selectionReason: `capability_fallback_${capability}`,
  }
}

/**
 * Queries live registry of providers and models from Cordis context (Issue #76).
 *
 * @param {object} ctx Cordis context
 * @param {object} [options={}]
 * @param {string} [options.provider] Optional provider filter
 * @param {string} [options.capability] Optional capability filter
 * @param {Array<object>} [options.allowedRoutes]
 * @returns {Promise<Array<object>>}
 */
export async function fetchModelCatalog(ctx, options = {}) {
  const selection = readModelSelection(ctx)
  const allowed = options.allowedRoutes || selection.allowedRoutes
  const models = []

  let providers = []
  if (ctx?.llm && typeof ctx.llm.listProviders === 'function') {
    try {
      providers = await ctx.llm.listProviders()
    } catch (_) {
      /* safe ignore */
    }
  }

  if (Array.isArray(providers) && providers.length > 0) {
    for (const p of providers) {
      const providerId = p.id || p.name || 'unknown'
      let provModels = p.models || []
      if (ctx?.llm && typeof ctx.llm.listModels === 'function') {
        try {
          const list = await ctx.llm.listModels(providerId)
          if (Array.isArray(list) && list.length > 0) {
            provModels = list
          }
        } catch (_) {
          /* safe ignore */
        }
      }

      for (const m of provModels) {
        const modelId = typeof m === 'string' ? m : (m?.id || m?.name)
        if (!modelId) continue
        const capabilities = inferModelCapabilities(modelId, providerId)
        const reasoningEffortSupported = isReasoningEffortSupported(providerId, modelId, typeof m === 'object' ? m : null)
        const maxTokens = (typeof m === 'object' && typeof m.maxTokens === 'number')
          ? m.maxTokens
          : resolveMaxTokens({ capabilities })
        const authorized = isRouteAllowed({ provider: providerId, model: modelId }, allowed)
        const chip = getModelIdentityChip({ provider: providerId, model: modelId }, { maxTokens, reasoningEffortSupported })

        models.push({
          provider: providerId,
          model: modelId,
          label: `${providerId}:${modelId}`,
          alias: chip.alias,
          chipText: chip.chipText,
          badgeClass: chip.badgeClass,
          capabilities,
          maxTokens,
          reasoningEffortSupported,
          supportedEfforts: reasoningEffortSupported ? ['off', 'low', 'medium', 'high', 'max'] : ['off'],
          authorized,
        })
      }
    }
  }

  // Fallback defaults if registry returns empty
  if (models.length === 0) {
    const defaultPool = [
      { provider: 'deepseek-official', model: 'deepseek-chat', maxTokens: 4096 },
      { provider: 'deepseek-official', model: 'deepseek-reasoner', maxTokens: 8192 },
      { provider: 'anthropic', model: 'claude-3-5-sonnet', maxTokens: 8192 },
    ]
    for (const item of defaultPool) {
      const capabilities = inferModelCapabilities(item.model, item.provider)
      const reasoningEffortSupported = isReasoningEffortSupported(item.provider, item.model)
      const chip = getModelIdentityChip(item, { maxTokens: item.maxTokens, reasoningEffortSupported })
      models.push({
        provider: item.provider,
        model: item.model,
        label: `${item.provider}:${item.model}`,
        alias: chip.alias,
        chipText: chip.chipText,
        badgeClass: chip.badgeClass,
        capabilities,
        maxTokens: item.maxTokens,
        reasoningEffortSupported,
        supportedEfforts: reasoningEffortSupported ? ['off', 'low', 'medium', 'high', 'max'] : ['off'],
        authorized: isRouteAllowed(item, allowed),
      })
    }
  }

  let result = models
  if (options.provider) {
    const targetProv = options.provider.toLowerCase()
    result = result.filter((m) => m.provider.toLowerCase() === targetProv)
  }
  if (options.capability) {
    const targetCap = options.capability.toLowerCase()
    result = result.filter((m) => m.capabilities.includes(targetCap))
  }

  return result
}

/**
 * Resolves the appropriate model for a specialist execution.
 * Combines role binding, capability routing (Issue #74), smart routing (Issue #48),
 * Candidate Shortlist check (Issue #82), maxTokens ceiling (Issue #79),
 * and reasoning effort negotiation (Issue #86).
 *
 * @param {object} params
 * @param {object} [params.roleModel] Model assigned to the role
 * @param {object} [params.fallbackModel] Fallback default model
 * @param {Array<{ provider: string, model: string, maxTokens?: number }>} [params.allowedRoutes]
 * @param {string} [params.roleId]
 * @param {string} [params.task]
 * @param {string} [params.capability]
 * @param {string} [params.reasoningEffort]
 * @param {number} [params.maxTokens]
 * @param {boolean} [params.smartRoutingEnabled=false]
 * @param {Array<string>} [params.allowedProviders=[]]
 * @param {Array<object>} [params.registryProviders=[]]
 * @param {Array<object>} [params.catalog=[]]
 * @param {boolean} [params.failFast=false]
 * @returns {{ provider: string, model: string, maxTokens: number, reasoningEffort?: string, warning?: string, candidateShortlist?: string[], selectionReason: string }}
 */
export function resolveSpecialistModel({
  roleModel,
  fallbackModel,
  allowedRoutes,
  roleId,
  task,
  capability,
  reasoningEffort,
  maxTokens: explicitMaxTokens,
  smartRoutingEnabled = false,
  allowedProviders = [],
  registryProviders = [],
  catalog = [],
  failFast = false,
}) {
  const defaultFallback = fallbackModel || { provider: 'deepseek-official', model: 'deepseek-chat' }
  let targetModel = roleModel || defaultFallback
  let selectionReason = roleModel ? 'role_preset' : 'default_fallback'

  // 1. Semantic Capability Routing (Issue #74)
  if (capability) {
    const byCap = resolveModelByCapability({
      capability,
      catalog,
      allowedRoutes,
      fallbackRoute: targetModel,
    })
    targetModel = { provider: byCap.provider, model: byCap.model }
    selectionReason = byCap.selectionReason
  }

  // 2. Smart Model Routing (Issue #48)
  if (!capability && smartRoutingEnabled && task) {
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

  // 3. Candidate Shortlist Validation (Issue #82)
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

  // 4. Official subagent-model-selection allowedRoutes constraint
  let matchedRoute = null
  if (allowedRoutes && allowedRoutes.length > 0) {
    matchedRoute = allowedRoutes.find((m) => m.provider === targetModel.provider && m.model === targetModel.model)
    if (!matchedRoute) {
      const safeFallback = allowedRoutes[0]
      warning = `Model ${targetModel.provider}:${targetModel.model} is not in subagent-model-selection.allowedModels; fell back to ${safeFallback.provider}:${safeFallback.model}`
      targetModel = { provider: safeFallback.provider, model: safeFallback.model }
      selectionReason = 'allowed_routes_fallback'
      matchedRoute = safeFallback
    }
  }

  // 5. Output tokens ceiling negotiation (Issue #79)
  const inferredCaps = inferModelCapabilities(targetModel.model, targetModel.provider)
  const effectiveMaxTokens = resolveMaxTokens({
    requestedMaxTokens: explicitMaxTokens,
    roleMaxTokens: roleModel?.maxTokens,
    routeMaxTokens: matchedRoute?.maxTokens,
    capabilities: inferredCaps,
  })

  // 6. Reasoning Effort negotiation & compatibility check (Issue #86)
  let effectiveReasoningEffort
  const requestedEffort = reasoningEffort || roleModel?.reasoningEffort
  if (requestedEffort && requestedEffort !== 'off' && requestedEffort !== 'disabled') {
    const normalized = normalizeReasoningEffort(requestedEffort)
    const supported = isReasoningEffortSupported(targetModel.provider, targetModel.model)
    if (supported) {
      effectiveReasoningEffort = normalized
    } else {
      const effortWarning = `Reasoning effort "${requestedEffort}" requested, but model ${targetModel.provider}:${targetModel.model} does not support reasoning effort; downgraded to standard mode`
      warning = warning ? `${warning}; ${effortWarning}` : effortWarning
      effectiveReasoningEffort = undefined
    }
  }

  return {
    provider: targetModel.provider,
    model: targetModel.model,
    maxTokens: effectiveMaxTokens,
    reasoningEffort: effectiveReasoningEffort,
    warning,
    candidateShortlist,
    selectionReason,
  }
}
