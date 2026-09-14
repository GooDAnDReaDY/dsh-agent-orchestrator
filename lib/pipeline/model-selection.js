/**
 * Model Pool and Route Resolver Helper for Multi-Agent Orchestrator.
 *
 * Integrates with dsh-tool-subagent's `subagent-model-selection` setting namespace:
 * - Reads authorized model list when present
 * - Validates role model bindings against authorized list
 * - Falls back gracefully when an unapproved model is requested
 */

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
 * Resolves the appropriate model for a specialist execution.
 *
 * @param {object} params
 * @param {object} [params.roleModel] Model assigned to the role
 * @param {object} [params.fallbackModel] Fallback default model
 * @param {Array<{ provider: string, model: string }>} [params.allowedRoutes]
 * @returns {{ provider: string, model: string, warning?: string }}
 */
export function resolveSpecialistModel({ roleModel, fallbackModel, allowedRoutes }) {
  const candidate = roleModel || fallbackModel || { provider: 'deepseek', model: 'deepseek-chat' }

  if (!allowedRoutes || allowedRoutes.length === 0) {
    return { provider: candidate.provider, model: candidate.model }
  }

  if (isRouteAllowed(candidate, allowedRoutes)) {
    return { provider: candidate.provider, model: candidate.model }
  }

  // Candidate is not allowed -> pick first allowed model as safe fallback
  const safeFallback = allowedRoutes[0]
  return {
    provider: safeFallback.provider,
    model: safeFallback.model,
    warning: `Model ${candidate.provider}:${candidate.model} is not in subagent-model-selection.allowedModels; fell back to ${safeFallback.provider}:${safeFallback.model}`,
  }
}
