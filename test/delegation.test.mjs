import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeRoleId,
  executeDirectDelegation,
} from '../lib/pipeline/delegation.js'
import { getDefaultRoles } from '../lib/pipeline/scenarios.js'

test('normalizeRoleId: correctly resolves aliases to canonical role IDs', () => {
  const roles = getDefaultRoles()

  assert.equal(normalizeRoleId('ui_design', roles), 'ui_design')
  assert.equal(normalizeRoleId('UI Design', roles), 'ui_design')
  assert.equal(normalizeRoleId('дизайнер', roles), 'ui_design')
  assert.equal(normalizeRoleId('дизайн', roles), 'ui_design')

  assert.equal(normalizeRoleId('frontend', roles), 'frontend')
  assert.equal(normalizeRoleId('фронтенд', roles), 'frontend')
  assert.equal(normalizeRoleId('фронт', roles), 'frontend')

  assert.equal(normalizeRoleId('backend', roles), 'backend')
  assert.equal(normalizeRoleId('бэкенд', roles), 'backend')
  assert.equal(normalizeRoleId('бэк', roles), 'backend')

  assert.equal(normalizeRoleId('qa', roles), 'qa_tests')
  assert.equal(normalizeRoleId('тестировщик', roles), 'qa_tests')

  assert.equal(normalizeRoleId('docs', roles), 'docs')
  assert.equal(normalizeRoleId('документация', roles), 'docs')

  assert.equal(normalizeRoleId('unknown_role', roles), 'architecture') // fallback
})

test('executeDirectDelegation: runs specialist worker with prompt cache alignment', async () => {
  const roles = getDefaultRoles()
  let capturedCall = null

  const mockCallLlm = async (args) => {
    capturedCall = args
    return {
      text: 'Mock Specialist Deliverable: Architecture specification completed.',
      usage: {
        prompt_tokens: 1800,
        completion_tokens: 220,
        prompt_cache_hit_tokens: 1500,
      },
    }
  }

  const result = await executeDirectDelegation({
    roleId: 'дизайнер',
    task: 'Create responsive drawer layout for plugin settings',
    context: 'Use Tailwind CSS tokens and Lucide icons.',
    roles,
    config: { projectType: 'dsh-plugin' },
    callLlm: mockCallLlm,
  })

  assert.equal(result.roleId, 'ui_design')
  assert.equal(result.roleName, 'UI/UX Interface Designer')
  assert.match(result.output, /Mock Specialist Deliverable/)
  assert.equal(result.metrics.cacheHitTokens, 1500)
  assert.equal(result.metrics.hitRatio, 0.8333)

  // Verify prompt structure has L1 static anchor and L2 task anchor in system prompt
  assert.ok(capturedCall !== null)
  assert.ok(capturedCall.messages.length >= 2)
  const systemPrompt = capturedCall.messages[0].content
  assert.match(systemPrompt, /CANONICAL REPOSITORY CONVENTIONS/)
  assert.match(systemPrompt, /PROMPT CACHING & PREFIX INTEGRITY NOTICE/)
  assert.match(systemPrompt, /Direct Delegation: UI\/UX Interface Designer/)

  // Verify user message has role persona and task
  const userPrompt = capturedCall.messages[1].content
  assert.match(userPrompt, /Assigned Agent Persona: UI\/UX Interface Designer/)
  assert.match(userPrompt, /Strict Boundaries: NEVER write backend/)
  assert.match(userPrompt, /dsh-ui-design/)
})
