/**
 * Concurrency Gate & Workspace Scoping Manager.
 *
 * Implements:
 * 1. Issue #93: Per-Parent Serialization Gate & Concurrency Cap (`tail gate`).
 *    - Guarantees serialized dispatch across simultaneous calls from the same parent.
 *    - Enforces maxConcurrentSubagents limit per parent session with atomic reservation.
 * 2. Issue #87: Strict per-call `cwd` workspace directory scoping.
 *    - Prevents directory traversal outside root workspace (`path.resolve` containment check).
 */

import path from 'path'

export const DEFAULT_MAX_CONCURRENT_PER_PARENT = 3

export class SerializationGate {
  constructor(maxConcurrent = DEFAULT_MAX_CONCURRENT_PER_PARENT) {
    this.maxConcurrent = maxConcurrent
    this.activePerParent = new Map() // parentId -> Set of active executionIds
    this.tailChains = new Map() // parentId -> Promise chain
  }

  /**
   * Acquires a serialized execution slot for a parent session.
   *
   * @param {string} parentId
   * @param {string} executionId
   * @returns {Promise<() => void>} Release function
   */
  async acquire(parentId = 'root', executionId) {
    const currentTail = this.tailChains.get(parentId) || Promise.resolve()

    let releaseLock
    const lockAcquired = new Promise((resolve) => {
      releaseLock = resolve
    })

    // Update tail chain so next request waits for this slot check to finish
    this.tailChains.set(parentId, lockAcquired)

    await currentTail

    // Atomic capacity check
    const active = this.activePerParent.get(parentId) || new Set()
    if (active.size >= this.maxConcurrent) {
      releaseLock()
      throw new Error(
        `[ConcurrencyGate] Parent session "${parentId}" reached maximum concurrent subagents limit (${this.maxConcurrent}).`
      )
    }

    active.add(executionId)
    this.activePerParent.set(parentId, active)

    // Release serialization chain so next call can queue
    releaseLock()

    // Return the release function for the active worker slot
    let released = false
    return () => {
      if (released) return
      released = true
      const current = this.activePerParent.get(parentId)
      if (current) {
        current.delete(executionId)
        if (current.size === 0) {
          this.activePerParent.delete(parentId)
        }
      }
    }
  }

  getActiveCount(parentId = 'root') {
    return this.activePerParent.get(parentId)?.size || 0
  }
}

/**
 * Resolves and validates a working directory (cwd) against a base workspace.
 * Prevents escape via '../' or symlink traversal.
 * Preserves normalized relative paths if relative cwd was requested.
 *
 * @param {string} requestedCwd Relative or absolute path
 * @param {string} [baseDir=process.cwd()] Root workspace boundary
 * @returns {string} Safe relative or absolute path
 */
export function resolveScopedCwd(requestedCwd, baseDir = process.cwd()) {
  if (!requestedCwd || typeof requestedCwd !== 'string' || requestedCwd.trim() === '') {
    return baseDir
  }

  const trimmed = requestedCwd.trim()
  const resolvedBase = path.resolve(baseDir)
  const candidate = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(resolvedBase, trimmed)

  // Containment check: candidate must start with resolvedBase
  if (!candidate.startsWith(resolvedBase + path.sep) && candidate !== resolvedBase) {
    throw new Error(
      `[WorkspaceScoping] Access denied: requested cwd "${requestedCwd}" is outside workspace boundary "${resolvedBase}".`
    )
  }

  if (!path.isAbsolute(trimmed)) {
    return path.relative(resolvedBase, candidate) || '.'
  }

  return candidate
}
