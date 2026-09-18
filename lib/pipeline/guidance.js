/**
 * System Prompt Guidance and Specialist Roster Injection.
 *
 * Injects section `orchestrator:roster` into the main chat agent's system prompt:
 * - Informs the agent of all active specialized roles and their capabilities
 * - Filters disabled roles (r.enabled !== false) (Issue #101)
 * - Provides instructions on when to call `orchestrator_delegate_specialist`
 * - Enforces Strict Separation of Duties (Design/Frontend vs Backend)
 */

import { toRolesArray } from './delegation.js'

export const ORCHESTRATOR_SECTION_NAME = 'orchestrator:roster'
export const ORCHESTRATOR_SECTION_ORDER = 55

/**
 * Pure projection of available roles onto system prompt guidance.
 *
 * @param {Array<object>|object} roles Available roles list or dict
 * @param {string} [toolName] Delegation tool name
 * @returns {string}
 */
export function renderOrchestratorRoster(roles = [], toolName = 'orchestrator_delegate_specialist') {
  const allRoles = toRolesArray(roles)
  // Enabled Roster Filter (Issue #101): only advertise active/enabled roles
  const rolesList = allRoles.filter((r) => r.enabled !== false)
  if (!rolesList || rolesList.length === 0) return ''

  const lines = [
    '### Multi-Agent Orchestrator: Specialized Subagent Roster',
    'You have access to a pool of specialized autonomous subagents. When the user asks you to give a task to a specialist or subagent (e.g. "дай задачу субагенту...", "попроси дизайнера...", "проверь через QA..."), NEVER do that specialized work yourself in a generic way — DELEGATE it immediately using the `' +
      toolName +
      '` tool.',
    '',
    '**Available Specialist Roles (use exact role ID in tool calls):**',
  ]

  for (const role of rolesList) {
    const modelTag = role.defaultModel
      ? ` [Model: ${role.defaultModel.provider}:${role.defaultModel.model}]`
      : ''
    lines.push(
      `- **${role.id}** (${role.displayName})${modelTag}: ${role.description}`
    )
    lines.push(`  → Delegate via: \`${toolName}({ roleId: "${role.id}", task: "..." })\``)
  }

  lines.push('')
  lines.push('**Core Delegation & Governance Rules:**')
  lines.push(
    '1. **Single Specialist Delegation**: When the user requests a single domain task ("дай задачу субагенту дизайнеру...", "пусть архитектор опишет..."), invoke `' +
      toolName +
      '` with the appropriate role ID and full context. Report the specialist\'s deliverable back to the user.'
  )
  lines.push(
    '2. **Full Multi-Agent Pipeline**: When the user requests an end-to-end coordinated project ("сделай через оркестратор...", "/orchestrate <task>"), dispatch a full orchestrated DAG pipeline via `orchestrator_dispatch`.'
  )
  lines.push(
    '3. **Strict Separation of Duties**: Design/Frontend specialists must NEVER implement database schemas or server backend endpoints. Backend specialists must NEVER design UI layouts or CSS styles. QA specialists must independently test contracts.'
  )
  lines.push(
    '4. **Visual Deliverable Status Callout**: Whenever presenting the output of a subagent delegation to the user in chat, you MUST ALWAYS include a clean, prominent callout banner at the very top of your response:\n' +
    '   - When you have reviewed the subagent deliverable and accepted it without issues:\n' +
    '     `> 🟢 **Получен результат работы от субагента [<Имя роли>] и принят агентом**`\n' +
    '   - When the deliverable had issues, needed changes, or you re-invoked the subagent for revisions:\n' +
    '     `> 🟡 **Результат получен от субагента [<Имя роли>] и отправлен на доработку (итерация X)**`\n' +
    '   - When the user asks you to send work back for rework or revisions:\n' +
    '     `> 🔄 **Задача отправлена на доработку субагенту [<Имя роли>]**`'
  )

  return lines.join('\n')
}

/**
 * Registers the specialist roster with the systemPrompt service.
 *
 * @param {object} ctx Cordis context
 * @param {function} getRoles Function returning current roles snapshot
 * @param {string} [toolName] Delegation tool name to reference
 */
export function applyGuidance(ctx, getRoles, toolName = 'orchestrator_delegate_specialist', options = {}) {
  ctx.inject(['systemPrompt'], (sctx) => {
    try {
      sctx.systemPrompt.addSection({
        name: ORCHESTRATOR_SECTION_NAME,
        order: ORCHESTRATOR_SECTION_ORDER,
        render: () => renderOrchestratorRoster(getRoles(), toolName),
      })
    } catch (e) {
      const log = options.logger || ctx.logger || null
      if (log?.warn) log.warn('[dsh-agent-orchestrator] Guidance section registration warning:', e?.message || e)
    }
  })
}
