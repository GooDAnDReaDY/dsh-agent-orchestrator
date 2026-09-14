import test from 'node:test'
import assert from 'node:assert/strict'
import { renderOrchestratorRoster } from '../lib/pipeline/guidance.js'
import { getDefaultRoles } from '../lib/pipeline/scenarios.js'

test('renderOrchestratorRoster: renders all roles and instructions', () => {
  const roles = getDefaultRoles()
  const prose = renderOrchestratorRoster(roles, 'orchestrator_delegate_specialist')

  assert.ok(prose.length > 500)
  assert.match(prose, /orchestrator_delegate_specialist/)
  assert.match(prose, /ui_design/)
  assert.match(prose, /backend/)
  assert.match(prose, /qa_tests/)
  assert.match(prose, /Strict Separation of Duties/)
  assert.match(prose, /Design\/Frontend specialists must NEVER implement database schemas/)
  assert.match(prose, /Visual Deliverable Status Callout/)
  assert.match(prose, /Получен результат работы от субагента/)
  assert.match(prose, /Результат получен от субагента/)
})

test('renderOrchestratorRoster: empty when no roles', () => {
  assert.equal(renderOrchestratorRoster([]), '')
})
