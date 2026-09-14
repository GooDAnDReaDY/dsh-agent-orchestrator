import test from 'node:test'
import assert from 'node:assert/strict'
import {
  readModelSelection,
  isRouteAllowed,
  resolveSpecialistModel,
} from '../lib/pipeline/model-selection.js'

test('readModelSelection: handles absent and empty settings', () => {
  assert.deepEqual(readModelSelection(null), { sectionPresent: false, allowedRoutes: undefined })
  assert.deepEqual(readModelSelection({}), { sectionPresent: false, allowedRoutes: undefined })

  const mockCtx = {
    settings: {
      get: (ns) => {
        if (ns === 'subagent-model-selection') {
          return {
            enabled: true,
            allowedModels: [
              { provider: 'deepseek', model: 'deepseek-chat' },
              { provider: 'deepseek', model: 'deepseek-reasoner' },
            ],
          }
        }
        return null
      },
    },
  }

  const selection = readModelSelection(mockCtx)
  assert.equal(selection.sectionPresent, true)
  assert.equal(selection.allowedRoutes.length, 2)
  assert.equal(selection.allowedRoutes[0].model, 'deepseek-chat')
})

test('isRouteAllowed: validates route membership', () => {
  const allowed = [
    { provider: 'deepseek', model: 'deepseek-chat' },
    { provider: 'anthropic', model: 'claude-3-5-sonnet' },
  ]

  assert.equal(isRouteAllowed({ provider: 'deepseek', model: 'deepseek-chat' }, allowed), true)
  assert.equal(isRouteAllowed({ provider: 'openai', model: 'gpt-4o' }, allowed), false)
  // Unconstrained when allowed list is undefined or empty
  assert.equal(isRouteAllowed({ provider: 'openai', model: 'gpt-4o' }, undefined), true)
  assert.equal(isRouteAllowed({ provider: 'openai', model: 'gpt-4o' }, []), true)
})

test('resolveSpecialistModel: falls back safely to allowed model', () => {
  const allowed = [
    { provider: 'deepseek', model: 'deepseek-chat' },
  ]

  // Role specifies deepseek-chat -> allowed directly
  const res1 = resolveSpecialistModel({
    roleModel: { provider: 'deepseek', model: 'deepseek-chat' },
    allowedRoutes: allowed,
  })
  assert.equal(res1.provider, 'deepseek')
  assert.equal(res1.model, 'deepseek-chat')
  assert.equal(res1.warning, undefined)

  // Role specifies unauthorized model -> falls back to allowed with warning
  const res2 = resolveSpecialistModel({
    roleModel: { provider: 'anthropic', model: 'claude-3-5-opus' },
    allowedRoutes: allowed,
  })
  assert.equal(res2.provider, 'deepseek')
  assert.equal(res2.model, 'deepseek-chat')
  assert.match(res2.warning, /not in subagent-model-selection\.allowedModels/)
})
