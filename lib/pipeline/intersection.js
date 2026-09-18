/**
 * Tool Intersection & Security Narrowing Engine.
 *
 * Enforces the core invariants:
 * 1. A subagent/specialist MUST NEVER receive more capabilities or tools than its parent.
 * 2. Anti-Redelegation Shield (Issue #103): child subagents cannot receive delegation tools
 *    (agent_run, orchestrator_*, delegate, list_subagents).
 * 3. Leaf Experts Guard (Issue #102): leaf specialized experts run with maxDepth: 1 and cannot spawn child tasks.
 * 4. Adaptive Tool Filter Sanitization & droppedTools (Issue #111):
 *    - Automatic intersection of role tools with parent/host capabilities.
 *    - Detailed droppedTools diagnostics categorized into 'security', 'denied', 'unknown', or 'session-local'.
 * 5. Bidirectional Tool Synonym Resolution: bridges DSH native tool names
 *    (read, edit, write, glob, grep, bash) with canonical agent aliases (view_file,
 *    replace_file_content, write_to_file, find_by_name, grep_search, run_command).
 * 6. Fail-Loud: If the resulting allowed tools set is empty while the role expects tools,
 *    delegation is blocked unless context is supplied for pure-reasoning fallback.
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
  'orchestrator_dispatch',
  'orchestrator_run',
  'delegate',
  'list_subagents',
  'subagent',
])

export const TOOL_SYNONYMS = {
  // Read
  read: ['read', 'view_file', 'read_file', 'cat'],
  view_file: ['read', 'view_file', 'read_file', 'cat'],
  read_file: ['read', 'view_file', 'read_file', 'cat'],

  // Write
  write: ['write', 'write_to_file', 'create_file'],
  write_to_file: ['write', 'write_to_file', 'create_file'],

  // Edit
  edit: ['edit', 'replace_file_content', 'edit_file', 'str_replace_editor'],
  replace_file_content: ['edit', 'replace_file_content', 'edit_file', 'str_replace_editor'],
  edit_file: ['edit', 'replace_file_content', 'edit_file', 'str_replace_editor'],

  // Glob / Find
  glob: ['glob', 'find_by_name', 'find_files', 'find'],
  find_by_name: ['glob', 'find_by_name', 'find_files', 'find'],

  // Grep / Search
  grep: ['grep', 'grep_search', 'search_text'],
  grep_search: ['grep', 'grep_search', 'search_text'],

  // Command / Bash
  bash: ['bash', 'run_command', 'execute_command', 'shell'],
  run_command: ['bash', 'run_command', 'execute_command', 'shell'],

  // Web
  search_web: ['search_web', 'web_search', 'google_search'],
  web_search: ['search_web', 'web_search', 'google_search'],
  read_url_content: ['read_url_content', 'web_fetch', 'fetch_url', 'curl'],
  web_fetch: ['read_url_content', 'web_fetch', 'fetch_url', 'curl'],
}

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
 * Finds if a candidate tool or any of its known synonyms exists in parentSet.
 * Returns the exact tool name available in parentSet, or null.
 */
function matchParentTool(toolName, parentSet) {
  if (!parentSet) return toolName
  if (parentSet.has(toolName)) return toolName

  const synonyms = TOOL_SYNONYMS[toolName] || []
  for (const syn of synonyms) {
    if (parentSet.has(syn)) {
      return syn
    }
  }
  return null
}

/**
 * Calculates the safe tool intersection for a specialist child session with
 * comprehensive droppedTools diagnostics (Issue #111).
 *
 * @param {object} params
 * @param {Array<string|object>} [params.parentTools] Tools available to parent session (undefined = standalone/test mode)
 * @param {Array<string|object>} [params.roleTools] Tools declared/requested by the role
 * @param {Array<string>} [params.denyList] Additional tools explicitly denied by config
 * @param {boolean} [params.failLoud=true] Throw error if intersection is empty
 * @param {string} [params.roleId] Role identifier for diagnostic error reporting
 * @returns {{ tools: string[], droppedTools: Array<{ tool: string, reason: string }>, diff: object }}
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
  const strippedSecurity = new Set()
  const denied = new Set()
  const allowed = new Set()
  const droppedTools = []

  const candidates = normRole !== undefined ? normRole : normParent !== undefined ? normParent : []

  // Security shield: track dangerous tools present in parent that are never allowed in children
  if (normParent !== undefined) {
    for (const tool of normParent) {
      if (FORBIDDEN_SECURITY_TOOLS.has(tool)) {
        strippedSecurity.add(tool)
        droppedTools.push({ tool, reason: 'security' })
      } else if (FORBIDDEN_DELEGATION_TOOLS.has(tool)) {
        strippedSecurity.add(tool)
        droppedTools.push({ tool, reason: 'anti-redelegation' })
      }
    }
  }

  for (const tool of candidates) {
    if (FORBIDDEN_SECURITY_TOOLS.has(tool)) {
      strippedSecurity.add(tool)
      if (!droppedTools.some((d) => d.tool === tool)) {
        droppedTools.push({ tool, reason: 'security' })
      }
      continue
    }
    if (FORBIDDEN_DELEGATION_TOOLS.has(tool)) {
      strippedSecurity.add(tool)
      if (!droppedTools.some((d) => d.tool === tool)) {
        droppedTools.push({ tool, reason: 'anti-redelegation' })
      }
      continue
    }
    if (normDeny.has(tool)) {
      denied.add(tool)
      if (!droppedTools.some((d) => d.tool === tool)) {
        droppedTools.push({ tool, reason: 'denied' })
      }
      continue
    }

    // Intersection with parent if parent tools constraint is provided
    if (parentSet !== null) {
      const parentMatch = matchParentTool(tool, parentSet)
      if (!parentMatch) {
        denied.add(tool)
        if (!droppedTools.some((d) => d.tool === tool)) {
          droppedTools.push({ tool, reason: 'unknown-or-unsupported' })
        }
        continue
      }
      // Granted with the parent's actual tool name
      allowed.add(parentMatch)
    } else {
      allowed.add(tool)
    }
  }

  const allowedList = Array.from(allowed)
  const strippedList = Array.from(strippedSecurity)
  const deniedList = Array.from(denied)

  if (failLoud && allowedList.length === 0 && (normRole ? normRole.length > 0 : true)) {
    throw new Error(
      `[ToolIntersection] SecurityViolation: Tool intersection for role "${roleId}" is empty. ` +
      `Role requested: [${normRole?.join(', ')}]. Parent available: [${normParent?.join(', ')}]. ` +
      `Stripped by policy: [${strippedList.join(', ')}]. Denied: [${deniedList.join(', ')}].`
    )
  }

  return {
    tools: allowedList,
    droppedTools,
    diff: {
      allowed: allowedList,
      strippedSecurity: strippedList,
      denied: deniedList,
      roleRequested: normRole || [],
      parentAvailable: normParent || [],
    },
  }
}
