/**
 * Tool Intersection & Security Narrowing Engine.
 *
 * Enforces the core invariant:
 * A subagent/specialist MUST NEVER receive more capabilities or tools than its parent.
 *
 * Formula:
 * childTools = (roleTools ∩ parentTools) \ {run_code, delegation_tools} \ denyList
 *
 * Principles:
 * 1. Mandatory exclusion of dangerous execution primitives (e.g. run_code).
 * 2. Anti-redelegation shield: subagents cannot invoke delegation or agent_run tools.
 * 3. Fail-Loud: If the resulting allowed tools set is empty while the role expects tools,
 *    delegation is loudly blocked before touching the LLM or starting a child session.
 */

export const FORBIDDEN_SECURITY_TOOLS = new Set([
  'run_code',
  'code_exec',
  'system_exec',
  'terminal_exec',
])

export const FORBIDDEN_DELEGATION_TOOLS = new Set([
  'agent_run',
  'orchestrator_delegate_specialist',
  'orchestrator_run',
  'delegate',
  'list_subagents',
  'subagent',
])

/**
 * Normalizes tool list from strings or tool schemas.
 * @param {Array<string|object>} tools
 * @returns {string[]}
 */
export function normalizeToolNames(tools) {
  if (!tools || !Array.isArray(tools)) return []
  return tools
    .map((t) => (typeof t === 'string' ? t : t?.name))
    .filter((n) => typeof n === 'string' && n.trim() !== '')
}

/**
 * Calculates the safe tool intersection for a specialist child session.
 *
 * @param {object} params
 * @param {Array<string|object>} [params.parentTools] Tools available to parent session (undefined = standalone/test mode)
 * @param {Array<string|object>} [params.roleTools] Tools declared/requested by the role
 * @param {Array<string>} [params.denyList] Additional tools explicitly denied by config
 * @param {boolean} [params.failLoud=true] Throw error if intersection is empty
 * @param {string} [params.roleId] Role identifier for diagnostic error reporting
 * @returns {{ tools: string[], diff: object }}
 */
export function resolveToolIntersection({
  parentTools = undefined,
  roleTools = undefined,
  denyList = [],
  failLoud = true,
  roleId = 'specialist',
} = {}) {
  const normParent = parentTools !== undefined ? normalizeToolNames(parentTools) : undefined
  const normRole = roleTools !== undefined ? normalizeToolNames(roleTools) : undefined
  const normDeny = new Set(normalizeToolNames(denyList))

  const parentSet = normParent !== undefined ? new Set(normParent) : null
  const strippedSecurity = []
  const denied = []
  const allowed = []

  const candidates = normRole !== undefined ? normRole : normParent !== undefined ? normParent : []

  // Security shield: track dangerous tools present in parent that are never allowed in children
  if (normParent !== undefined) {
    for (const tool of normParent) {
      if (FORBIDDEN_SECURITY_TOOLS.has(tool) || FORBIDDEN_DELEGATION_TOOLS.has(tool)) {
        strippedSecurity.push(tool)
      }
    }
  }

  for (const tool of candidates) {
    if (FORBIDDEN_SECURITY_TOOLS.has(tool)) {
      strippedSecurity.push(tool)
      continue
    }
    if (FORBIDDEN_DELEGATION_TOOLS.has(tool)) {
      strippedSecurity.push(tool)
      continue
    }
    if (normDeny.has(tool)) {
      denied.push(tool)
      continue
    }
    // Intersection with parent if parent tools constraint is provided
    if (parentSet !== null && !parentSet.has(tool)) {
      denied.push(tool)
      continue
    }
    allowed.push(tool)
  }

  const uniqueAllowed = Array.from(new Set(allowed))

  // Fail-Loud validation:
  // If role requested tools, and parent tools constraint was provided, but intersection is empty:
  if (
    failLoud &&
    normRole !== undefined &&
    normRole.length > 0 &&
    uniqueAllowed.length === 0 &&
    normParent !== undefined
  ) {
    const requestedStr = normRole.join(', ')
    const strippedStr = strippedSecurity.join(', ')
    const deniedStr = denied.join(', ')
    throw new Error(
      `SecurityViolation: Tool intersection for role "${roleId}" is empty. Requested [${requestedStr}], but none are permitted by parent or security policy (stripped: [${strippedStr}], denied: [${deniedStr}])`
    )
  }

  return {
    tools: uniqueAllowed,
    diff: {
      parentTools: normParent || [],
      roleTools: normRole || normParent || [],
      allowed: uniqueAllowed,
      denied: Array.from(new Set(denied)),
      strippedSecurity: Array.from(new Set(strippedSecurity)),
    },
  }
}
