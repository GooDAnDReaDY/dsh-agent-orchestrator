/**
 * Prompt Caching & Prefix Canonicalization Optimizer for DeepSeek Harness.
 *
 * Guarantees byte-level prefix invariance for multi-agent workflows:
 * 1. Layer 1: Canonical Static Base Anchor (>= 1024 tokens) containing ecosystem guidelines,
 *    coding standards, and tool contracts.
 * 2. Layer 2: Shared Task Anchor containing user prompt, issue metadata, and global plan.
 * 3. Layer 3: Cumulative Upstream Artifacts (Append-Only sequence) preserving 100% KV-cache continuity.
 * 4. Layer 4: Role-specific Execution Directive (Role prompt, skills, subtask instructions).
 *
 * Extracts and calculates prompt_cache_hit_tokens telemetry.
 */

export const MIN_CACHE_ANCHOR_TOKENS = 1024

/**
 * Generates a stable, canonical base anchor that exceeds 1024 tokens.
 * Byte-for-byte identical across all agent calls sharing the same model.
 *
 * @param {object} [config={}]
 * @param {string} [config.projectType='dsh-plugin']
 * @param {string} [config.customRules='']
 * @returns {string} Static anchor block
 */
export function buildStaticBaseAnchor(config = {}) {
  const projectType = config.projectType || 'dsh-plugin'
  const customRules = config.customRules || ''

  // Standard architectural rules for DSH & TypeScript/ESM projects
  return [
    '# CANONICAL REPOSITORY CONVENTIONS AND AGENT PROTOCOL',
    '',
    '## 1. ECOSYSTEM ARCHITECTURE & STRICT BOUNDARIES',
    `- Project Framework: DeepSeek Harness (DSH) Multi-Agent Architecture [Type: ${projectType}].`,
    '- Target Runtime: Node.js >= 20, ECMAScript Modules (ESM) exclusively.',
    '- Package Scope: All internal extensions and plugins follow `@goodandready/<package>` convention.',
    '- Identity Invariance: The package name must match in package.json, cordis.patch.yml, and client __ModuleLoader__.load({ id }).',
    '- Bundle Size Gate: Maximum file size must not exceed 262,144 bytes (256 KiB); maintain below 250 KiB threshold.',
    '- Style Isolation: Every client style must declare `data-dsh-plugin="<plugin-id>"` and use unique class prefixes.',
    '- Color Theming: Use exclusively system CSS theme variables (e.g., `--dsw-alias-bg-layer-3`, `--dsw-alias-border-l2`, `--dsw-alias-label-primary`). Never hardcode hex/rgb colors.',
    '- Localization Protocol: Client strings must register via `ctx.effect(() => ctx.locale.register(NS, { en, zh, ru }), ...)` with proper disposers.',
    '- State Disposer Invariance: All side-effects, DOM manipulations, intervals, and event subscriptions must return reliable cleanup functions.',
    '- Safe Service Injection: Declare all required cordis services in `module.exports.inject = [...]` before accessing them in `apply(ctx)`.',
    '',
    '## 2. ENGINEERING EXECUTION STANDARDS & CODE QUALITY',
    '- Principle of Least Astonishment (POLA): Solutions must be direct, minimal, and devoid of speculative abstractions.',
    '- Standard Library First: Leverage native Node.js / Web APIs (`node:path`, `node:crypto`, `node:fs/promises`, `URL`, `AbortController`) before adding external dependencies.',
    '- Deterministic Behavior: All algorithms, parsers, and graph planners must be idempotent and testable without active network or daemon daemons.',
    '- Pure Domain Logic: Business logic, graph solvers, and formatting utilities must remain decoupled from Cordis or UI layers.',
    '- Full Output Enforcement: Never truncate code, never omit methods with placeholders (such as `// ... rest of code`), and output complete implementations.',
    '- Defensive Error Handling: Catch transient socket/rate-limit anomalies gracefully; propagate structural blockers explicitly to orchestration DAG.',
    '- Zero Dead Exports: Every exported function or constant must have an active consumer, caller, or formal unit test coverage.',
    '- Safe Concurrency: Asynchronous tasks must run behind bounded concurrency gates, avoiding unbounded background worker pool resource exhaustion.',
    '- Secure Subprocess Boundaries: Avoid shell injection by strictly sanitizing parameters and using structured array arguments in process spawns.',
    '',
    '## 3. MULTI-AGENT DAG COORDINATION CONTRACT & LIFECYCLE',
    '- Directed Acyclic Graph: Tasks execute in topological order with strict dependency resolution and cycle detection.',
    '- Upstream Data Invariance: Inputs received from predecessor stages are read-only immutable contracts.',
    '- Downstream Artifact Delivery: Outputs must be clearly demarcated with machine-parseable headers and human-readable summaries.',
    '- Role Specialization: Agents must focus strictly on their designated domain (architecture, spec, ui, code, tests, or documentation).',
    '- Decision Ledger Tracking: Subagent routing and decisions must emit structured audit events to the decision ledger for traceability.',
    '- Stage Validation Gate: Each stage outcome must be validated against schema and acceptance constraints prior to marking stage as complete.',
    '- Rejection & Rework Protocol: Failed or incomplete stage outputs must trigger targeted rework with explicit iteration feedback.',
    '- Execution Isolation: Child subagent sessions operate within isolated execution bubbles with strictly scoped tool sets.',
    customRules ? `\n## 4. PROJECT-SPECIFIC OVERRIDES\n${customRules}\n` : '',
    '',
    '## 5. PROMPT CACHING & PREFIX INTEGRITY NOTICE',
    'This system prefix is intentionally structured and token-padded to optimize KV-cache reuse across agent calls.',
    'Do not inject dynamic timestamps, random session identifiers, or non-deterministic variables prior to this anchor.',
    'All LLM calls sharing the same base model will reuse this exact prefix block directly from the hardware KV-cache.',
    'The anchor length is calibrated to meet or exceed MIN_CACHE_ANCHOR_TOKENS (1024 tokens) to satisfy provider cache boundaries.',
    '================================================================================',
  ].join('\n')
}

/**
 * Formats the shared task anchor (Layer 2).
 */
export function buildSharedTaskAnchor(task = {}) {
  const taskId = task.id || 'unassigned-task'
  const title = task.title || 'Untitled Task'
  const description = task.description || task.body || ''
  const issueUrl = task.issueUrl || ''
  const repo = task.repo || ''
  const scenario = task.scenario || 'standard'

  return [
    '## GLOBAL WORKFLOW TASK ANCHOR',
    `- Task Reference ID: ${taskId}`,
    `- Repository / Workspace: ${repo || 'local-context'}`,
    issueUrl ? `- Gitea Issue: ${issueUrl}` : '',
    `- Pipeline Scenario: ${scenario}`,
    `- Objective Title: ${title}`,
    '',
    '### Task Specification:',
    description.trim(),
    '',
    '--------------------------------------------------------------------------------',
  ].filter(Boolean).join('\n')
}

/**
 * Formats prior stage artifacts into an append-only cumulative sequence (Layer 3).
 * Preserves the exact prefix of all prior stages so subsequent LLM calls hit the cache.
 *
 * @param {Array<{ stageId: string, roleId: string, output: string }>} stageArtifacts
 * @returns {string} Formatted cumulative block
 */
export function formatCumulativeArtifacts(stageArtifacts = []) {
  if (!Array.isArray(stageArtifacts) || stageArtifacts.length === 0) {
    return ''
  }

  const parts = ['## UPSTREAM STAGE ARTIFACTS (CUMULATIVE CONTEXT)']
  for (const art of stageArtifacts) {
    parts.push(
      `\n### [STAGE OUTPUT: ${art.stageId}] (Role: ${art.roleId || 'unknown'})\n` +
      '```markdown\n' +
      (typeof art.output === 'string' ? art.output.trim() : JSON.stringify(art.output, null, 2)) +
      '\n```'
    )
  }
  parts.push('\n--------------------------------------------------------------------------------')
  return parts.join('\n')
}

/**
 * Assembles the full prompt messages array for an agent execution step.
 * Guarantees that Layer 1, Layer 2, and Layer 3 form an unbroken byte prefix.
 *
 * @param {object} params
 * @param {string} params.baseAnchor Layer 1
 * @param {string} params.taskAnchor Layer 2
 * @param {string} params.cumulativeArtifacts Layer 3
 * @param {object} params.agentRole
 * @param {string} params.agentRole.name
 * @param {string} params.agentRole.id
 * @param {string} params.agentRole.systemPrompt
 * @param {Array<string>} [params.agentRole.skills]
 * @param {object} params.currentStage
 * @param {string} params.currentStage.id
 * @param {string} params.currentStage.name
 * @param {string} params.currentStage.subtaskScope
 * @returns {Array<{ role: string, content: string }>} Messages array
 */
export function assembleAgentMessages({
  baseAnchor,
  taskAnchor,
  cumulativeArtifacts,
  agentRole = {},
  currentStage = {},
}) {
  // System prompt: Shared Base Anchor (L1) + Shared Task Anchor (L2) + Cumulative Artifacts (L3)
  const systemPrefix = [
    baseAnchor,
    '',
    taskAnchor,
    '',
    cumulativeArtifacts,
  ].filter(Boolean).join('\n')

  // User message: Layer 4 (Specific role, skills, subtask directives)
  const skillsList = Array.isArray(agentRole.skills) && agentRole.skills.length > 0
    ? agentRole.skills.map((s) => `- ${s}`).join('\n')
    : 'None'

  const userDirective = [
    `# ACTIVE EXECUTION DIRECTIVE: STAGE [${currentStage.name || currentStage.id}]`,
    '',
    `## Assigned Agent Persona: ${agentRole.name || agentRole.id}`,
    agentRole.systemPrompt ? `### Specialized Role Instructions:\n${agentRole.systemPrompt.trim()}\n` : '',
    '### Active Skills / Capabilities:',
    skillsList,
    '',
    '### Stage Objectives & Scope:',
    (currentStage.subtaskScope || currentStage.name || 'Execute designated stage deliverables.').trim(),
    '',
    '### Delivery Requirements:',
    '1. Produce complete, production-ready deliverables adhering strictly to the repository conventions.',
    '2. Provide clean explanations of architectural choices, interfaces, and test guarantees.',
    '3. Do not duplicate upstream artifacts unless directly refining or referencing them.',
    '4. Begin your response directly with the deliverable content.',
  ].filter(Boolean).join('\n')

  return [
    { role: 'system', content: systemPrefix },
    { role: 'user', content: userDirective },
  ]
}

/**
 * Extracts and normalizes prompt cache telemetry from LLM usage payloads.
 *
 * @param {object} usage Raw usage object from API stream
 * @returns {object} Normalized metrics { promptTokens, completionTokens, totalTokens, cacheHitTokens, cacheMissTokens, hitRatio, estimatedSavingsPct }
 */
export function extractCacheMetrics(usage = {}) {
  const promptTokens = usage.prompt_tokens ?? usage.inputTokens ?? usage.promptTokens ?? 0
  const completionTokens = usage.completion_tokens ?? usage.outputTokens ?? usage.completionTokens ?? 0
  
  // Prompt caching fields from DeepSeek, OpenAI, or Anthropic
  const cacheHitTokens = usage.prompt_cache_hit_tokens 
    ?? usage.cache_read_input_tokens 
    ?? usage.cached_prompt_tokens 
    ?? 0

  const cacheMissTokens = usage.prompt_cache_miss_tokens 
    ?? usage.cache_creation_input_tokens 
    ?? Math.max(0, promptTokens - cacheHitTokens)

  const totalTokens = promptTokens + completionTokens
  const hitRatio = promptTokens > 0 ? (cacheHitTokens / promptTokens) : 0

  // DeepSeek cache hit is ~90% cheaper than cache miss (0.14$/M vs 1.4$/M)
  const estimatedSavingsPct = Math.round(hitRatio * 90)

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cacheHitTokens,
    cacheMissTokens,
    hitRatio: parseFloat(hitRatio.toFixed(4)),
    estimatedSavingsPct,
  }
}
