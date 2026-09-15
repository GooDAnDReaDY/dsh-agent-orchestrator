import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { inferScenarioComplexity, decomposeTask } from '../lib/pipeline/decomposer.js'

describe('Task Decomposer', () => {
  it('correctly infers complexity level from textual cues', () => {
    assert.equal(inferScenarioComplexity('поправь опечатку в переменной'), 'simple')
    assert.equal(inferScenarioComplexity('hotfix crash on null in store.js'), 'simple')
    assert.equal(inferScenarioComplexity('новый плагин для DSH с нуля полная архитектура'), 'complex')
    assert.equal(inferScenarioComplexity('добавь фильтр по статусу в карточку настроек'), 'medium')
  })

  it('decomposes a task into customized stages with task context injected', () => {
    const taskTitle = 'Реализовать темную тему в канбане'
    const taskDesc = 'Добавить поддержку темной темы с CSS-переменными --dsw-alias-* и сохранением в настройки.'

    const plan = decomposeTask({
      taskTitle,
      taskDescription: taskDesc,
      scenarioId: 'medium',
    })

    assert.ok(plan.pipelineId)
    assert.equal(plan.scenarioId, 'medium')
    assert.equal(plan.stages.length, 4)

    // Check that each stage has customized subtaskScope containing the user's objective
    for (const stage of plan.stages) {
      assert.ok(stage.subtaskScope.includes(taskTitle))
      assert.ok(stage.assignedModel?.model)
    }
  })
})

