/**
 * Natural language intent detection for Multi-Agent Orchestrator.
 *
 * Recognizes:
 * - Slash commands: /orchestrate, /orc
 * - Russian triggers: "сделай через оркестратор", "запусти оркестратор", "используй режим оркестратора"
 * - English triggers: "orchestrate:", "orchestrate <task>", "use orchestrate mode"
 */

const KNOWN_SCENARIOS = ['hotfix', 'simple', 'medium', 'complex', 'enterprise', 'auto']

/**
 * Extracts optional scenario keyword if the first token is a known scenario.
 */
function extractScenarioAndTask(rawText) {
  const trimmed = (rawText || '').trim()
  if (!trimmed) {
    return { scenarioId: 'auto', taskTitle: 'Interactive Orchestrated Task' }
  }

  const parts = trimmed.split(/\s+/)
  const first = parts[0].toLowerCase().replace(/^[:#]/, '')
  if (KNOWN_SCENARIOS.includes(first) && parts.length > 1) {
    return {
      scenarioId: first,
      taskTitle: parts.slice(1).join(' ').trim(),
    }
  }

  return {
    scenarioId: 'auto',
    taskTitle: trimmed,
  }
}

/**
 * Detects whether an incoming chat message is an orchestration request.
 *
 * @param {string} text Raw message text
 * @returns {{ isTrigger: boolean, action?: 'on' | 'off', scenarioId?: string, taskTitle?: string }}
 */
export function detectOrchestratorIntent(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { isTrigger: false }
  }

  const trimmed = text.trim()

  // 1. Slash command: /orchestrate [scenario] [task] or /orc [scenario] [task]
  const slashMatch = trimmed.match(/^\/(?:orchestrate|orc)(?:\s+(.*))?$/i)
  if (slashMatch) {
    const rest = (slashMatch[1] || '').trim()
    if (rest.toLowerCase() === 'off') {
      return { isTrigger: true, action: 'off' }
    }
    const { scenarioId, taskTitle } = extractScenarioAndTask(rest)
    return {
      isTrigger: true,
      action: 'on',
      scenarioId,
      taskTitle,
    }
  }

  // 2. Russian natural language triggers
  // e.g. "сделай через оркестратор: ...", "запусти оркестратор: ...", "используй режим оркестратора ..."
  const ruMatch = trimmed.match(
    /^(?:пожалуйста[, ]*)?(?:сделай(?:\s+это)?\s+через\s+оркестратор|запусти(?:\s+задачу\s+через)?\s+оркестратор|используй\s+режим\s+оркестратора)(?:[\s:]+(.*))?$/i
  )
  if (ruMatch) {
    const rest = (ruMatch[1] || '').trim()
    const { scenarioId, taskTitle } = extractScenarioAndTask(rest)
    return {
      isTrigger: true,
      action: 'on',
      scenarioId,
      taskTitle,
    }
  }

  // 3. English natural language triggers
  // e.g. "orchestrate: ...", "use orchestrate mode: ...", "run in orchestrator mode: ..."
  const enMatch = trimmed.match(
    /^(?:please\s+)?(?:orchestrate|use\s+orchestrate\s+mode|run\s+(?:this\s+)?in\s+orchestrator\s+mode)(?:[\s:]+(.*))?$/i
  )
  if (enMatch) {
    const rest = (enMatch[1] || '').trim()
    const { scenarioId, taskTitle } = extractScenarioAndTask(rest)
    return {
      isTrigger: true,
      action: 'on',
      scenarioId,
      taskTitle,
    }
  }

  return { isTrigger: false }
}
