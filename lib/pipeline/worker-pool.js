/**
 * Worker Pool Dispatcher for DSH Multi-Agent Orchestrator.
 *
 * Dispatches stage executions to LLM instances with:
 * - Canonical prefix alignment (Prompt Caching maximization)
 * - Transient retry handling (HTTP 429, network timeouts)
 * - Streaming token collection
 * - Telemetry recording (Cache Hit ratio, duration, token usage)
 */

import {
  buildStaticBaseAnchor,
  buildSharedTaskAnchor,
  formatCumulativeArtifacts,
  assembleAgentMessages,
  extractCacheMetrics,
} from './cache-prefixer.js'
import { resolveSpecialistModel } from './model-selection.js'

/**
 * Invokes LLM with exponential backoff on recoverable transient errors.
 */
export async function callWithTransientRetry(callLlmFn, args, maxRetries = 2, baseDelayMs = 1500) {
  let attempt = 0
  while (true) {
    try {
      return await callLlmFn(args)
    } catch (err) {
      attempt++
      const msg = err?.message || String(err)
      const isTransient = /429|rate limit|quota|502|503|504|econnreset|etimedout|socket hang up/i.test(msg)
      if (attempt <= maxRetries && isTransient) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1)
        await new Promise((r) => setTimeout(r, delay))
        continue
      }
      throw err
    }
  }
}

/**
 * Executes a single pipeline stage with full prompt cache alignment.
 *
 * @param {object} stage Stage definition
 * @param {object} context Execution context
 * @param {object} context.pipeline Global pipeline metadata
 * @param {object} context.agentRole Configured role for this stage
 * @param {object} context.config Plugin configuration
 * @param {function} context.callLlm Function to call DSH LLM
 * @param {object} context.upstreamOutputs Prior stage outputs map
 * @param {function} [context.onStreamDelta] Streaming callback
 * @returns {Promise<{ output: string, metrics: object }>}
 */
export async function executeStageWorker(stage, context) {
  const { pipeline, agentRole, config = {}, callLlm, upstreamOutputs = {}, onStreamDelta } = context

  if (typeof callLlm !== 'function') {
    throw new Error('callLlm function is required to execute stage worker')
  }

  // 1. Build Layer 1: Static Base Anchor (> 1024 tokens)
  const baseAnchor = buildStaticBaseAnchor({
    projectType: config.projectType || 'dsh-plugin',
    customRules: config.customRules || '',
  })

  // 2. Build Layer 2: Shared Task Anchor
  const taskAnchor = buildSharedTaskAnchor({
    id: pipeline.pipelineId,
    title: pipeline.taskTitle,
    description: pipeline.taskDescription,
    repo: pipeline.repo,
    issueUrl: pipeline.issueUrl,
    scenario: pipeline.scenarioId,
  })

  // 3. Build Layer 3: Cumulative Upstream Artifacts (Append-Only)
  const priorArtifactsList = []
  for (const [depId, artContent] of Object.entries(upstreamOutputs)) {
    priorArtifactsList.push({
      stageId: depId,
      roleId: stage.dependsOn?.find((d) => d === depId) || 'upstream',
      output: artContent || '',
    })
  }
  const cumulativeArtifacts = formatCumulativeArtifacts(priorArtifactsList)

  // 4. Assemble canonical prompt (Layer 1 + 2 + 3 in System, Layer 4 in User)
  const messages = assembleAgentMessages({
    baseAnchor,
    taskAnchor,
    cumulativeArtifacts,
    agentRole,
    currentStage: stage,
  })

  const { provider, model, warning, maxTokens: resolvedMaxTokens, reasoningEffort } = resolveSpecialistModel({
    roleModel: agentRole.defaultModel,
    fallbackModel: { provider: 'deepseek', model: 'deepseek-chat' },
    allowedRoutes: context.allowedRoutes,
    capability: agentRole.capability,
    reasoningEffort: agentRole.reasoningEffort,
  })

  if (warning) {
    console.warn(`[dsh-agent-orchestrator] ${warning}`)
  }

  const temperature = agentRole.temperature ?? 0.3
  const maxTokens = resolvedMaxTokens ?? agentRole.maxTokens ?? 4096

  // 5. Execute LLM call with retry
  const result = await callWithTransientRetry(
    callLlm,
    {
      provider,
      model,
      messages,
      temperature,
      maxTokens,
      reasoningEffort,
      onStreamDelta,
    },
    2,
    1200
  )

  const outputText = result.text || result.content || ''
  const rawUsage = result.usage || {}
  const cacheMetrics = extractCacheMetrics(rawUsage)

  return {
    output: outputText,
    metrics: {
      ...cacheMetrics,
      model: `${provider}:${model}`,
      stageId: stage.id,
      roleId: stage.roleId,
    },
  }
}
