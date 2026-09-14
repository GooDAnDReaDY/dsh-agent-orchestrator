import test from 'node:test'
import assert from 'node:assert/strict'
import { detectOrchestratorIntent } from '../lib/pipeline/intent.js'

test('detectOrchestratorIntent: slash commands', () => {
  const t1 = detectOrchestratorIntent('/orchestrate hotfix fix login timeout')
  assert.equal(t1.isTrigger, true)
  assert.equal(t1.action, 'on')
  assert.equal(t1.scenarioId, 'hotfix')
  assert.equal(t1.taskTitle, 'fix login timeout')

  const t2 = detectOrchestratorIntent('/orc rebuild search index')
  assert.equal(t2.isTrigger, true)
  assert.equal(t2.action, 'on')
  assert.equal(t2.scenarioId, 'auto')
  assert.equal(t2.taskTitle, 'rebuild search index')

  const t3 = detectOrchestratorIntent('/orchestrate off')
  assert.equal(t3.isTrigger, true)
  assert.equal(t3.action, 'off')

  const t4 = detectOrchestratorIntent('/orchestrate')
  assert.equal(t4.isTrigger, true)
  assert.equal(t4.action, 'on')
  assert.equal(t4.scenarioId, 'auto')
})

test('detectOrchestratorIntent: Russian natural language phrases', () => {
  const t1 = detectOrchestratorIntent('сделай через оркестратор создать страницу профиля')
  assert.equal(t1.isTrigger, true)
  assert.equal(t1.action, 'on')
  assert.equal(t1.scenarioId, 'auto')
  assert.equal(t1.taskTitle, 'создать страницу профиля')

  const t2 = detectOrchestratorIntent('пожалуйста, сделай через оркестратор: complex переписать авторизацию')
  assert.equal(t2.isTrigger, true)
  assert.equal(t2.scenarioId, 'complex')
  assert.equal(t2.taskTitle, 'переписать авторизацию')

  const t3 = detectOrchestratorIntent('запусти оркестратор simple добавить экспорт csv')
  assert.equal(t3.isTrigger, true)
  assert.equal(t3.scenarioId, 'simple')
  assert.equal(t3.taskTitle, 'добавить экспорт csv')

  const t4 = detectOrchestratorIntent('используй режим оркестратора enterprise создать биллинг')
  assert.equal(t4.isTrigger, true)
  assert.equal(t4.scenarioId, 'enterprise')
  assert.equal(t4.taskTitle, 'создать биллинг')
})

test('detectOrchestratorIntent: English natural language phrases', () => {
  const t1 = detectOrchestratorIntent('orchestrate: refactor payment gateway')
  assert.equal(t1.isTrigger, true)
  assert.equal(t1.scenarioId, 'auto')
  assert.equal(t1.taskTitle, 'refactor payment gateway')

  const t2 = detectOrchestratorIntent('use orchestrate mode enterprise overhaul auth')
  assert.equal(t2.isTrigger, true)
  assert.equal(t2.scenarioId, 'enterprise')
  assert.equal(t2.taskTitle, 'overhaul auth')
})

test('detectOrchestratorIntent: normal conversations are ignored', () => {
  assert.equal(detectOrchestratorIntent('привет, как дела?').isTrigger, false)
  assert.equal(detectOrchestratorIntent('что делает этот плагин?').isTrigger, false)
  assert.equal(detectOrchestratorIntent('').isTrigger, false)
  assert.equal(detectOrchestratorIntent(null).isTrigger, false)
})
