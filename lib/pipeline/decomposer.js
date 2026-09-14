/**
 * Task Decomposition Engine for DSH Multi-Agent Orchestrator.
 *
 * Automatically or semi-automatically breaks down tasks received from
 * DSH chat or Gitea Kanban into concrete subtask stages based on chosen or inferred scenario.
 */

import { getDefaultScenarios, getDefaultRoles } from './scenarios.js'

/**
 * Infers scenario complexity based on task description cues.
 *
 * @param {string} taskText
 * @returns {'simple' | 'medium' | 'complex'}
 */
export function inferScenarioComplexity(taskText = '') {
  const text = (taskText || '').toLowerCase()

  // Complex triggers: new plugin, full system, architecture from scratch, major refactor
  const complexRegex = /новый плагин|с нуля|полная архитектур|рефакторинг всего|from scratch|new plugin|system design|major refactor|complex pipeline|5-6 этап|сложн/i
  if (complexRegex.test(text)) {
    return 'complex'
  }

  // Simple triggers: bugfix, typo, minor change, quick edit, small parameter
  const simpleRegex = /баг|опечатк|поправь|быстро|мелк|hotfix|bugfix|typo|quick fix|minor|bump|1-2 этап|прост/i
  if (simpleRegex.test(text)) {
    return 'simple'
  }

  // Default to medium
  return 'medium'
}

/**
 * Decomposes a task into a customized execution plan using a scenario preset.
 *
 * @param {object} params
 * @param {string} params.taskTitle
 * @param {string} params.taskDescription
 * @param {string} [params.scenarioId] 'simple' | 'medium' | 'complex' or 'auto'
 * @param {object} [params.customScenarios]
 * @param {object} [params.customRoles]
 * @returns {object} Decomposed pipeline plan { scenarioId, stages, taskTitle, taskDescription }
 */
export function decomposeTask({
  taskTitle = '',
  taskDescription = '',
  scenarioId = 'auto',
  customScenarios = null,
  customRoles = null,
}) {
  const scenarios = customScenarios || getDefaultScenarios()
  const roles = customRoles || getDefaultRoles()

  let selectedScenarioId = scenarioId
  if (!selectedScenarioId || selectedScenarioId === 'auto') {
    selectedScenarioId = inferScenarioComplexity(`${taskTitle}\n${taskDescription}`)
  }

  const scenario = scenarios[selectedScenarioId] || scenarios.medium

  // Clone stages and inject customized task scope
  const instantiatedStages = scenario.stages.map((stage) => {
    const role = roles[stage.roleId] || {}
    let customizedScope = stage.subtaskScope || ''

    // Contextualize subtask instructions with the overall goal
    customizedScope = [
      `Overall Objective: "${taskTitle}"`,
      `Deliverable Category: ${role.category || stage.roleId}`,
      `Specific Guidance: ${customizedScope}`,
      `Task Details:\n${taskDescription.trim()}`,
    ].join('\n\n')

    return {
      ...stage,
      subtaskScope: customizedScope,
      roleName: role.name || stage.roleId,
      assignedModel: role.defaultModel || { provider: 'deepseek', model: 'deepseek-chat' },
      skills: role.skills || [],
    }
  })

  return {
    pipelineId: `pipe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    scenarioId: selectedScenarioId,
    scenarioTitle: scenario.title,
    taskTitle: taskTitle || 'Untitled Pipeline Task',
    taskDescription: taskDescription || '',
    stages: instantiatedStages,
    createdAt: Date.now(),
  }
}

