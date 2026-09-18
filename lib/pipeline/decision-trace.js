/**
 * Multi-layered Decision Trace Ledger.
 *
 * Implements Issue #108:
 * - Records reasons for agent selection, model resolution, tool filtering, and execution timings.
 * - Formatted for injection into `presentationMeta` so UI can inspect the trace without polluting LLM context.
 * - Strict size limiter (`assertTraceSize <= 4096B`) with cascade truncation of secondary fields:
 *   logs -> checks -> calls -> summary.
 */

export const MAX_TRACE_BYTES = 4096

/**
 * Validates and measures the JSON-serialized byte size of a decision trace.
 * @param {object} trace
 * @returns {number}
 */
export function getTraceByteLength(trace) {
  return Buffer.byteLength(JSON.stringify(trace || {}), 'utf-8')
}

/**
 * Truncates trace cascadingly if it exceeds MAX_TRACE_BYTES.
 * Hierarchy of reduction:
 * 1. Truncate long log messages (to max 64 chars)
 * 2. Drop debug logs array entirely
 * 3. Truncate droppedTools array
 * 4. Truncate reasoning/rationale text
 * 5. Minimal fallback summary
 *
 * @param {object} rawTrace
 * @param {number} [maxBytes=MAX_TRACE_BYTES]
 * @returns {object} Guaranteed <= maxBytes
 */
export function sanitizeDecisionTrace(rawTrace, maxBytes = MAX_TRACE_BYTES) {
  if (!rawTrace || typeof rawTrace !== 'object') {
    return { error: 'Empty trace' }
  }

  let trace = JSON.parse(JSON.stringify(rawTrace))
  if (getTraceByteLength(trace) <= maxBytes) {
    return trace
  }

  // Level 1: Truncate logs items
  if (Array.isArray(trace.logs)) {
    trace.logs = trace.logs.map((l) =>
      typeof l === 'string' && l.length > 64 ? `${l.slice(0, 61)}...` : l
    )
    if (getTraceByteLength(trace) <= maxBytes) return trace
  }

  // Level 2: Drop logs array completely
  if (trace.logs) {
    delete trace.logs
    if (getTraceByteLength(trace) <= maxBytes) return trace
  }

  // Level 3: Compact droppedTools
  if (Array.isArray(trace.droppedTools) && trace.droppedTools.length > 5) {
    const count = trace.droppedTools.length
    trace.droppedTools = trace.droppedTools.slice(0, 5)
    trace.droppedToolsCount = count
    if (getTraceByteLength(trace) <= maxBytes) return trace
  }

  // Level 4: Truncate rationale / context
  if (typeof trace.rationale === 'string' && trace.rationale.length > 120) {
    trace.rationale = `${trace.rationale.slice(0, 117)}...`
    if (getTraceByteLength(trace) <= maxBytes) return trace
  }

  // Level 5: Aggressive compaction to minimal essence
  return {
    executionId: trace.executionId,
    roleId: trace.roleId,
    model: trace.model,
    decision: trace.decision || 'delegated',
    droppedCount: Array.isArray(rawTrace.droppedTools) ? rawTrace.droppedTools.length : 0,
    truncated: true,
  }
}

/**
 * Creates a structured Decision Trace object.
 */
export function createDecisionTrace({
  executionId,
  roleId,
  roleName,
  requestedModel,
  assignedModel,
  selectionReason = 'preset_match',
  toolSummary,
  droppedTools = [],
  depth = 1,
  durationMs,
  status = 'completed',
  rationale,
}) {
  const trace = {
    executionId,
    timestamp: Date.now(),
    roleId,
    roleName,
    depth,
    model: {
      requested: requestedModel,
      assigned: assignedModel,
      reason: selectionReason,
    },
    tools: {
      allowedCount: toolSummary?.allowed?.length ?? 0,
      strippedCount: toolSummary?.strippedSecurity?.length ?? 0,
      deniedCount: toolSummary?.denied?.length ?? 0,
    },
    droppedTools: droppedTools.slice(0, 15),
    rationale,
    durationMs,
    status,
  }

  return sanitizeDecisionTrace(trace, MAX_TRACE_BYTES)
}
