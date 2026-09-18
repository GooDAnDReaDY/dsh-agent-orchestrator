import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchModelCatalog,
  inferModelCapabilities,
  resolveModelByCapability,
  isReasoningEffortSupported,
  normalizeReasoningEffort,
  resolveMaxTokens,
  getModelIdentityChip,
  resolveSpecialistModel,
  MODEL_CAPABILITIES,
  REASONING_EFFORTS,
} from '../lib/pipeline/model-selection.js'
import { executeDirectDelegation } from '../lib/pipeline/delegation.js'
import { apply } from '../lib/index.js'

describe('Batch 5: Dynamic Catalog, Capability Routing, maxTokens, Reasoning Effort & Model Chips', () => {

  // --- Issue #76: Dynamic Provider & Model Catalog Discovery ---
  describe('Issue #76: Dynamic Catalog Discovery (model_subagent_catalog)', () => {
    it('fetchModelCatalog: discovers models from live ctx.llm providers and models registry', async () => {
      const mockCtx = {
        llm: {
          listProviders: () => [
            { id: 'deepseek-official', name: 'DeepSeek Official' },
            { id: 'anthropic', name: 'Anthropic' },
          ],
          listModels: (providerId) => {
            if (providerId === 'deepseek-official') {
              return [
                { id: 'deepseek-chat', maxTokens: 4096 },
                { id: 'deepseek-reasoner', maxTokens: 8192, reasoning: { supported: true } },
              ]
            }
            if (providerId === 'anthropic') {
              return [
                { id: 'claude-3-5-sonnet', maxTokens: 8192 },
              ]
            }
            return []
          },
        },
        settings: { get: () => null },
      }

      const catalog = await fetchModelCatalog(mockCtx)
      assert.equal(catalog.length, 3)

      const reasoner = catalog.find((m) => m.model === 'deepseek-reasoner')
      assert.ok(reasoner, 'deepseek-reasoner must exist in catalog')
      assert.equal(reasoner.provider, 'deepseek-official')
      assert.equal(reasoner.reasoningEffortSupported, true)
      assert.ok(reasoner.capabilities.includes('reasoning'))
      assert.equal(reasoner.maxTokens, 8192)
      assert.equal(reasoner.alias, 'R1')
      assert.equal(reasoner.chipText, '[Reasoner · R1]')

      const chat = catalog.find((m) => m.model === 'deepseek-chat')
      assert.ok(chat, 'deepseek-chat must exist in catalog')
      assert.equal(chat.reasoningEffortSupported, false)
      assert.ok(chat.capabilities.includes('coding') || chat.capabilities.includes('general'))
    })

    it('fetchModelCatalog: filters by provider and capability options', async () => {
      const mockCtx = {
        llm: {
          listProviders: () => [
            { id: 'deepseek-official', models: ['deepseek-chat', 'deepseek-reasoner'] },
            { id: 'anthropic', models: ['claude-3-5-sonnet', 'claude-3-5-haiku'] },
          ],
        },
        settings: { get: () => null },
      }

      const onlyAnthropic = await fetchModelCatalog(mockCtx, { provider: 'anthropic' })
      assert.equal(onlyAnthropic.length, 2)
      assert.ok(onlyAnthropic.every((m) => m.provider === 'anthropic'))

      const onlyReasoning = await fetchModelCatalog(mockCtx, { capability: 'reasoning' })
      assert.equal(onlyReasoning.length, 1)
      assert.equal(onlyReasoning[0].model, 'deepseek-reasoner')
    })

    it('model_subagent_catalog tool: is registered and executes cleanly', async () => {
      let registeredTool = null
      const mockCtx = {
        tools: {
          register: (def) => {
            if (def.name === 'model_subagent_catalog') {
              registeredTool = def
            }
            return () => {}
          },
        },
        llm: {
          listProviders: () => [
            { id: 'deepseek-official', models: ['deepseek-chat', 'deepseek-reasoner'] },
          ],
        },
        effect: (fn) => fn(),
        on: () => () => {},
        inject: () => {},
        settings: { register: () => ({ get: () => ({}) }) },
        webServer: { register: () => () => {} },
      }

      apply(mockCtx, { enabled: true })
      assert.ok(registeredTool, 'model_subagent_catalog tool must be registered')
      assert.equal(registeredTool.name, 'model_subagent_catalog')

      const rawResult = await registeredTool.execute({ capability: 'reasoning' })
      const parsed = JSON.parse(rawResult)
      assert.ok(parsed.total >= 1)
      assert.equal(parsed.catalog[0].model, 'deepseek-reasoner')
    })
  })

  // --- Issue #74: Semantic Model Capability Tags ---
  describe('Issue #74: Semantic Capability Tags (coding, reasoning, fast, general)', () => {
    it('inferModelCapabilities: detects appropriate tags from model IDs', () => {
      assert.ok(inferModelCapabilities('deepseek-reasoner').includes(MODEL_CAPABILITIES.REASONING))
      assert.ok(inferModelCapabilities('o1-preview').includes(MODEL_CAPABILITIES.REASONING))
      assert.ok(inferModelCapabilities('o3-mini').includes(MODEL_CAPABILITIES.REASONING))
      assert.ok(inferModelCapabilities('o3-mini').includes(MODEL_CAPABILITIES.FAST))

      assert.ok(inferModelCapabilities('deepseek-coder').includes(MODEL_CAPABILITIES.CODING))
      assert.ok(inferModelCapabilities('claude-3-5-sonnet').includes(MODEL_CAPABILITIES.CODING))

      assert.ok(inferModelCapabilities('claude-3-5-haiku').includes(MODEL_CAPABILITIES.FAST))
      assert.ok(inferModelCapabilities('gpt-4o-mini').includes(MODEL_CAPABILITIES.FAST))

      assert.ok(inferModelCapabilities('custom-unknown-model').includes(MODEL_CAPABILITIES.GENERAL))
    })

    it('resolveModelByCapability: selects best matching candidate from catalog respecting allowedRoutes', () => {
      const catalog = [
        { provider: 'deepseek-official', model: 'deepseek-chat', capabilities: ['coding', 'general'], maxTokens: 4096 },
        { provider: 'deepseek-official', model: 'deepseek-reasoner', capabilities: ['reasoning', 'deep-reasoning'], maxTokens: 8192 },
        { provider: 'openai', model: 'gpt-4o-mini', capabilities: ['fast', 'fast-search'], maxTokens: 2048 },
      ]

      const matchedReasoning = resolveModelByCapability({
        capability: 'reasoning',
        catalog,
      })
      assert.equal(matchedReasoning.model, 'deepseek-reasoner')
      assert.equal(matchedReasoning.maxTokens, 8192)

      const matchedFast = resolveModelByCapability({
        capability: 'fast',
        catalog,
      })
      assert.equal(matchedFast.model, 'gpt-4o-mini')
      assert.equal(matchedFast.maxTokens, 2048)

      // Respects allowedRoutes constraint
      const restrictedAllowed = [{ provider: 'deepseek-official', model: 'deepseek-chat' }]
      const fallbackOnRestricted = resolveModelByCapability({
        capability: 'fast',
        catalog,
        allowedRoutes: restrictedAllowed,
        fallbackRoute: restrictedAllowed[0],
      })
      assert.equal(fallbackOnRestricted.model, 'deepseek-chat')
    })
  })

  // --- Issue #79: maxTokens per Model Route ---
  describe('Issue #79: Granular maxTokens Ceiling per Model Route', () => {
    it('resolveMaxTokens: computes appropriate ceiling by capability and explicit override', () => {
      assert.equal(resolveMaxTokens({ requestedMaxTokens: 12000 }), 12000)
      assert.equal(resolveMaxTokens({ roleMaxTokens: 6000 }), 6000)
      assert.equal(resolveMaxTokens({ routeMaxTokens: 3000 }), 3000)
      assert.equal(resolveMaxTokens({ capabilities: ['fast'] }), 2048)
      assert.equal(resolveMaxTokens({ capabilities: ['reasoning'] }), 8192)
      assert.equal(resolveMaxTokens({ capabilities: ['general'] }), 4096)
    })

    it('executeDirectDelegation: propagates custom maxTokens to callLlm and presentationMeta', async () => {
      let capturedCallArgs = null
      const mockCallLlm = async (args) => {
        capturedCallArgs = args
        return {
          text: 'Specialist output deliverable',
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }
      }

      const res = await executeDirectDelegation({
        roleId: 'architecture',
        task: 'Design auth system',
        callLlm: mockCallLlm,
        maxTokens: 2048,
      })

      assert.ok(capturedCallArgs, 'callLlm must be called')
      assert.equal(capturedCallArgs.maxTokens, 2048)
      assert.equal(res.maxTokens, 2048)
      assert.equal(res.presentationMeta.maxTokens, 2048)
    })
  })

  // --- Issue #86: Reasoning Effort Control & Compatibility ---
  describe('Issue #86: Reasoning Effort Control (off, low, medium, high, max)', () => {
    it('isReasoningEffortSupported: detects compatibility accurately', () => {
      assert.equal(isReasoningEffortSupported('deepseek-official', 'deepseek-reasoner'), true)
      assert.equal(isReasoningEffortSupported('deepseek-official', 'deepseek-chat'), false)
      assert.equal(isReasoningEffortSupported('openai', 'o1-preview'), true)
      assert.equal(isReasoningEffortSupported('openai', 'o3-mini'), true)
      assert.equal(isReasoningEffortSupported('anthropic', 'claude-3-5-sonnet'), false)
    })

    it('normalizeReasoningEffort: normalizes off/disabled and validates supported tiers', () => {
      assert.equal(normalizeReasoningEffort('off'), 'off')
      assert.equal(normalizeReasoningEffort('disabled'), 'off')
      assert.equal(normalizeReasoningEffort('none'), 'off')
      assert.equal(normalizeReasoningEffort('low'), 'low')
      assert.equal(normalizeReasoningEffort('medium'), 'medium')
      assert.equal(normalizeReasoningEffort('high'), 'high')
      assert.equal(normalizeReasoningEffort('max'), 'max')
      assert.equal(normalizeReasoningEffort('invalid'), 'medium')
    })

    it('resolveSpecialistModel: negotiates reasoning effort and gracefully downgrades incompatible models', () => {
      // 1. Supported model with reasoning effort
      const resSupported = resolveSpecialistModel({
        roleModel: { provider: 'deepseek-official', model: 'deepseek-reasoner' },
        reasoningEffort: 'high',
      })
      assert.equal(resSupported.reasoningEffort, 'high')
      assert.equal(resSupported.warning, undefined)

      // 2. Incompatible model: gracefully downgrades without throwing
      const resIncompatible = resolveSpecialistModel({
        roleModel: { provider: 'deepseek-official', model: 'deepseek-chat' },
        reasoningEffort: 'max',
      })
      assert.equal(resIncompatible.reasoningEffort, undefined)
      assert.match(resIncompatible.warning, /does not support reasoning effort/)
    })

    it('executeDirectDelegation: passes reasoningEffort to callLlm when supported', async () => {
      let capturedArgs = null
      const mockCallLlm = async (args) => {
        capturedArgs = args
        return { text: 'Analytical result', usage: {} }
      }

      const customRoles = [
        {
          id: 'architecture',
          name: 'Chief Architect',
          defaultModel: { provider: 'deepseek-official', model: 'deepseek-reasoner' },
          reasoningEffort: 'high',
        },
      ]

      await executeDirectDelegation({
        roleId: 'architecture',
        task: 'Design event pipeline',
        roles: customRoles,
        callLlm: mockCallLlm,
      })

      assert.ok(capturedArgs)
      assert.equal(capturedArgs.reasoningEffort, 'high')
    })
  })

  // --- Issue #73: Model Identity Chips ---
  describe('Issue #73: Model Identity Chips with friendly aliases', () => {
    it('getModelIdentityChip: produces friendly labels, aliases, and informative tooltips', () => {
      const chipReasoner = getModelIdentityChip({ provider: 'deepseek-official', model: 'deepseek-reasoner' })
      assert.equal(chipReasoner.alias, 'R1')
      assert.equal(chipReasoner.label, 'Reasoner')
      assert.equal(chipReasoner.chipText, '[Reasoner · R1]')
      assert.equal(chipReasoner.badgeClass, 'reasoner')
      assert.match(chipReasoner.tooltip, /deepseek-official:deepseek-reasoner/)

      const chipChat = getModelIdentityChip({ provider: 'deepseek-official', model: 'deepseek-chat' })
      assert.equal(chipChat.alias, 'V3')
      assert.equal(chipChat.label, 'Fast Coder')
      assert.equal(chipChat.chipText, '[Fast Coder · V3]')
      assert.equal(chipChat.badgeClass, 'coder')

      const chipSonnet = getModelIdentityChip({ provider: 'anthropic', model: 'claude-3-5-sonnet' })
      assert.equal(chipSonnet.alias, 'Sonnet 3.5')
      assert.equal(chipSonnet.label, 'Coder')
      assert.equal(chipSonnet.chipText, '[Coder · Sonnet 3.5]')

      const chipMini = getModelIdentityChip({ provider: 'openai', model: 'gpt-4o-mini' })
      assert.equal(chipMini.alias, 'Mini')
      assert.equal(chipMini.label, 'Fast')
      assert.equal(chipMini.chipText, '[Fast · Mini]')
      assert.equal(chipMini.badgeClass, 'fast')
    })
  })
})
