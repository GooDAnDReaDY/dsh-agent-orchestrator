/**
 * Deterministic Max-Tokens Watchdog.
 *
 * Implements Issue #75:
 * 1. Turn-end interception when output is truncated due to max-tokens limit.
 * 2. Flush Checkpoint: flushes state to prevent lost progress.
 * 3. Continue-Once Guarantee: strictly allows at most ONE automated continuation per execution.
 * 4. Cycle Protection: if truncation occurs again, halts with MaxTokensLoopError demanding
 *    subtask decomposition, preventing infinite loops and token drain.
 */

export class MaxTokensLoopError extends Error {
  constructor(message, { executionId, continuationCount = 1 } = {}) {
    super(message)
    this.name = 'MaxTokensLoopError'
    this.executionId = executionId
    this.continuationCount = continuationCount
  }
}

/**
 * Checks whether a given stop reason or response indicates token limit exhaustion.
 *
 * @param {string|object} stopReason
 * @returns {boolean}
 */
export function isMaxTokensTruncated(stopReason) {
  if (!stopReason) return false
  if (typeof stopReason === 'object') {
    if (stopReason.kind === 'max-tokens' || stopReason.kind === 'length') return true
    if (stopReason.stopReason === 'max_tokens' || stopReason.stopReason === 'length') return true
    return false
  }

  const s = String(stopReason).toLowerCase()
  return s === 'max-tokens' || s === 'max_tokens' || s === 'length' || s.includes('token_limit')
}

/**
 * Wraps a turn / worker execution with Deterministic max-tokens Watchdog.
 *
 * @param {object} params
 * @param {function} params.executeTurn Function (continuationCount) => Promise<{ output: string, stopReason: string, raw?: any }>
 * @param {function} [params.flushCheckpoint] Callback to persist session checkpoint before continuation
 * @param {string} [params.continuationPrompt='Continue generation precisely from where you stopped.']
 * @param {string} [params.executionId]
 * @returns {Promise<{ output: string, stopReason: string, continuationCount: number, wasTruncated: boolean }>}
 */
export async function runWithMaxTokensWatchdog({
  executeTurn,
  flushCheckpoint,
  continuationPrompt = 'Continue generation precisely from where you stopped.',
  executionId = 'turn',
}) {
  let continuationCount = 0
  let combinedOutput = ''

  // Step 1: Initial turn
  const initialResult = await executeTurn(0, '')
  combinedOutput = initialResult.output || ''

  if (!isMaxTokensTruncated(initialResult.stopReason)) {
    return {
      output: combinedOutput,
      stopReason: initialResult.stopReason || 'completed',
      continuationCount: 0,
      wasTruncated: false,
    }
  }

  // Step 2: First truncation detected -> trigger single automated continuation
  continuationCount = 1

  if (typeof flushCheckpoint === 'function') {
    try {
      await flushCheckpoint()
    } catch (err) {
      console.debug('[MaxTokensWatchdog] flushCheckpoint warning:', err?.message || err)
    }
  }

  const secondResult = await executeTurn(continuationCount, continuationPrompt)
  combinedOutput += (combinedOutput ? '\n' : '') + (secondResult.output || '')

  // Step 3: Cycle Protection Check (Continue-Once Guarantee)
  if (isMaxTokensTruncated(secondResult.stopReason)) {
    throw new MaxTokensLoopError(
      `[MaxTokensWatchdog] Task "${executionId}" truncated by token limit twice. ` +
      `Automated continuation aborted to prevent infinite token consumption. Please decompose the task into smaller subtasks.`,
      { executionId, continuationCount }
    )
  }

  return {
    output: combinedOutput,
    stopReason: secondResult.stopReason || 'completed',
    continuationCount,
    wasTruncated: true,
  }
}
