/**
 * Subagent Session Lifecycle, Capacity Recycling, and Reversible Archive Manager.
 *
 * Implements:
 * 1. Event-based and timer-based auto-archiving of one-shot subagents after grace period (#56).
 * 2. Projection cache cleanup (`session_projcache.json`) to prevent bloat (#56).
 * 3. Capacity Recycling with Priority Cascade Rotation (#67):
 *    - Enforces hard ceiling on total sessions (default: 400).
 *    - Eviction Tier 1: completed one-shot subagents (oldest-first by completedAt).
 *    - Eviction Tier 2: stale continuable subagents exceeding inactivity threshold.
 *    - Eviction Tier 3: main sessions (only if cleanMain is enabled).
 *    - Pin Whitelist: pinned and active sessions are strictly protected from eviction.
 * 4. Two-Phase Reversible Cleanup (#57):
 *    - Phase 1 (Reversible Archive): Moves session data to `sessions-archive/<workspace>/<sessionId>`.
 *    - Restore Support: Allows restoring archived session before retention expires.
 *    - Phase 2 (Physical Retention Deletion): Permanently deletes files after retention period (default 24h).
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

export const DEFAULT_GRACE_PERIOD_MS = 3 * 60 * 1000 // 3 minutes
export const DEFAULT_RECONCILE_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
export const DEFAULT_MAX_CAPACITY = 400 // Issue #67
export const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000 // 24 hours (Issue #57)
export const DEFAULT_INACTIVITY_THRESHOLD_MS = 60 * 60 * 1000 // 1 hour

export class SessionLifecycleManager {
  /**
   * @param {object} [options]
   * @param {number} [options.gracePeriodMs=180000]
   * @param {number} [options.reconcileIntervalMs=300000]
   * @param {number} [options.maxCapacity=400] Issue #67
   * @param {number} [options.retentionMs=86400000] Issue #57
   * @param {number} [options.inactivityThresholdMs=3600000]
   * @param {string} [options.archiveDir] Directory for reversible sessions archive
   * @param {string} [options.workspace='default']
   * @param {string} [options.projCachePath]
   * @param {object} [options.subagentsService]
   * @param {object} [options.sessionsService]
   * @param {function} [options.onArchive]
   * @param {function} [options.onDelete]
   */
  constructor(options = {}) {
    this.gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS
    this.reconcileIntervalMs = options.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS
    this.maxCapacity = options.maxCapacity ?? DEFAULT_MAX_CAPACITY
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS
    this.inactivityThresholdMs = options.inactivityThresholdMs ?? DEFAULT_INACTIVITY_THRESHOLD_MS
    this.workspace = options.workspace || 'default'

    // Default archive dir: ~/.dsh/sessions-archive/<workspace>
    const homeDir = os.homedir()
    this.archiveBaseDir =
      options.archiveDir || path.join(homeDir, '.dsh', 'sessions-archive', this.workspace)

    this.projCachePath = options.projCachePath || null
    this.subagentsService = options.subagentsService || null
    this.sessionsService = options.sessionsService || null
    this.onArchive = options.onArchive || null
    this.onDelete = options.onDelete || null

    /**
     * @type {Map<string, {
     *   id: string,
     *   registeredAt: number,
     *   lastActivityAt: number,
     *   completedAt: number|null,
     *   status: 'active'|'completed'|'archived',
     *   mode: 'one-shot'|'continuable'|'main',
     *   isPinned: boolean,
     *   timer: any,
     *   retentionTimer: any,
     *   metadata: object,
     *   archivedPath?: string
     * }>}
     */
    this.sessions = new Map()

    this.reconcileTimer = null
    if (this.reconcileIntervalMs > 0 && typeof setInterval === 'function') {
      this.reconcileTimer = setInterval(() => {
        this.reconcile().catch((err) => {
          console.debug('[SessionLifecycle] reconcile error:', err?.message || err)
        })
      }, this.reconcileIntervalMs)
      this.reconcileTimer?.unref?.()
    }
  }

  /**
   * Registers a session.
   *
   * @param {string} sessionId
   * @param {object} [options]
   */
  register(sessionId, options = {}) {
    if (!sessionId) return
    const existing = this.sessions.get(sessionId)
    if (existing) {
      existing.lastActivityAt = Date.now()
      existing.metadata = { ...existing.metadata, ...options }
      if (options.isPinned !== undefined) existing.isPinned = Boolean(options.isPinned)
      return
    }

    const now = Date.now()
    this.sessions.set(sessionId, {
      id: sessionId,
      registeredAt: now,
      lastActivityAt: now,
      completedAt: null,
      status: 'active',
      mode: options.mode || 'one-shot',
      isPinned: Boolean(options.isPinned),
      timer: null,
      retentionTimer: null,
      metadata: options,
    })

    // Check capacity recycling upon new registration (Issue #67)
    this.enforceCapacityRecycling()
  }

  /**
   * Records activity to update lastActivityAt.
   */
  touch(sessionId) {
    const entry = this.sessions.get(sessionId)
    if (entry) {
      entry.lastActivityAt = Date.now()
    }
  }

  /**
   * Sets pinned status protecting session from eviction.
   */
  setPinned(sessionId, isPinned = true) {
    const entry = this.sessions.get(sessionId)
    if (entry) {
      entry.isPinned = Boolean(isPinned)
    }
  }

  /**
   * Marks a session as finished and schedules auto-archiving after the grace period.
   *
   * @param {string} sessionId
   * @param {object} [result]
   */
  markCompleted(sessionId, result = {}) {
    if (!sessionId) return
    let entry = this.sessions.get(sessionId)
    if (!entry) {
      this.register(sessionId, { mode: 'one-shot', result })
      entry = this.sessions.get(sessionId)
    }

    const now = Date.now()
    entry.completedAt = now
    entry.lastActivityAt = now
    entry.status = 'completed'
    entry.metadata = { ...entry.metadata, result }

    if (entry.timer) {
      clearTimeout(entry.timer)
    }

    entry.timer = setTimeout(() => {
      this.archive(sessionId).catch((err) => {
        console.debug('[SessionLifecycle] archive timer error:', err?.message || err)
      })
    }, this.gracePeriodMs)
    entry.timer?.unref?.()

    // Trigger recycling check if capacity exceeded
    this.enforceCapacityRecycling()
  }

  /**
   * Phase 1: Reversible Archive (Issue #57).
   * Moves session into sessions-archive/<workspace>/<sessionId> and starts retention timer.
   *
   * @param {string} sessionId
   * @returns {Promise<boolean>}
   */
  async archive(sessionId) {
    const entry = this.sessions.get(sessionId)
    if (!entry) return false

    if (entry.timer) {
      clearTimeout(entry.timer)
      entry.timer = null
    }

    entry.status = 'archived'

    // 1. Call DSH subagents / sessions service archive if available
    try {
      if (this.subagentsService && typeof this.subagentsService.archive === 'function') {
        await this.subagentsService.archive(sessionId)
      } else if (this.subagentsService && typeof this.subagentsService.dispose === 'function') {
        await this.subagentsService.dispose(sessionId)
      }
    } catch (err) {
      console.debug('[SessionLifecycle] subagents archive skipped:', err?.message || err)
    }

    try {
      if (this.sessionsService && typeof this.sessionsService.archive === 'function') {
        await this.sessionsService.archive(sessionId)
      }
    } catch (err) {
      console.debug('[SessionLifecycle] sessions archive skipped:', err?.message || err)
    }

    // 2. Synchronous/safe cleanup of session_projcache.json (Issue #56)
    if (this.projCachePath) {
      this.purgeFromProjCache(sessionId, this.projCachePath)
    }

    // 3. Phase 1: Create reversible archive directory entry (Issue #57)
    try {
      const sessionArchiveDir = path.join(this.archiveBaseDir, sessionId)
      if (!fs.existsSync(sessionArchiveDir)) {
        fs.mkdirSync(sessionArchiveDir, { recursive: true })
      }
      const metaPath = path.join(sessionArchiveDir, 'meta.json')
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            sessionId,
            workspace: this.workspace,
            archivedAt: Date.now(),
            retentionExpiresAt: Date.now() + this.retentionMs,
            entry: {
              registeredAt: entry.registeredAt,
              completedAt: entry.completedAt,
              mode: entry.mode,
              metadata: entry.metadata,
            },
          },
          null,
          2
        ),
        'utf-8'
      )
      entry.archivedPath = sessionArchiveDir
    } catch (err) {
      console.debug('[SessionLifecycle] session archive directory creation warning:', err?.message || err)
    }

    if (typeof this.onArchive === 'function') {
      try {
        this.onArchive(sessionId, entry.metadata)
      } catch (err) {
        console.debug('[SessionLifecycle] onArchive callback error:', err?.message || err)
      }
    }

    // Phase 2: Schedule physical retention deletion (Issue #57)
    if (this.retentionMs > 0) {
      entry.retentionTimer = setTimeout(() => {
        this.physicalDelete(sessionId).catch((err) => {
          console.debug('[SessionLifecycle] retention physical delete error:', err?.message || err)
        })
      }, this.retentionMs)
      entry.retentionTimer?.unref?.()
    }

    return true
  }

  /**
   * Restores an archived session back to active state before retention expiration (Issue #57).
   *
   * @param {string} sessionId
   * @returns {boolean} True if successfully restored
   */
  restore(sessionId) {
    const entry = this.sessions.get(sessionId)
    const sessionArchiveDir = path.join(this.archiveBaseDir, sessionId)

    if (!entry && !fs.existsSync(sessionArchiveDir)) {
      return false
    }

    if (entry) {
      if (entry.retentionTimer) {
        clearTimeout(entry.retentionTimer)
        entry.retentionTimer = null
      }
      entry.status = 'active'
      entry.completedAt = null
      entry.lastActivityAt = Date.now()
    } else {
      // Reconstitute from archive meta.json
      try {
        const raw = fs.readFileSync(path.join(sessionArchiveDir, 'meta.json'), 'utf-8')
        const data = JSON.parse(raw)
        this.register(sessionId, data.entry?.metadata || {})
      } catch (err) {
        console.debug('[SessionLifecycle] failed to restore meta:', err?.message || err)
        return false
      }
    }

    // Clean up archive directory
    try {
      if (fs.existsSync(sessionArchiveDir)) {
        fs.rmSync(sessionArchiveDir, { recursive: true, force: true })
      }
    } catch (err) {
      console.debug('[SessionLifecycle] restore archive cleanup warning:', err?.message || err)
    }

    return true
  }

  /**
   * Phase 2: Physically deletes session and its archive files from disk (Issue #57).
   *
   * @param {string} sessionId
   */
  async physicalDelete(sessionId) {
    const entry = this.sessions.get(sessionId)
    if (entry?.retentionTimer) {
      clearTimeout(entry.retentionTimer)
      entry.retentionTimer = null
    }

    const sessionArchiveDir = path.join(this.archiveBaseDir, sessionId)
    try {
      if (fs.existsSync(sessionArchiveDir)) {
        fs.rmSync(sessionArchiveDir, { recursive: true, force: true })
      }
    } catch (err) {
      console.debug('[SessionLifecycle] physical deletion error:', err?.message || err)
    }

    if (typeof this.onDelete === 'function') {
      try {
        this.onDelete(sessionId)
      } catch (err) {
        console.debug('[SessionLifecycle] onDelete callback warning:', err?.message || err)
      }
    }

    this.sessions.delete(sessionId)
  }

  /**
   * Enforces Capacity Recycling with Priority Cascade Rotation (Issue #67).
   *
   * When total tracked sessions exceed maxCapacity:
   * 1. Priority 1: completed one-shot subagents (oldest-first by completedAt)
   * 2. Priority 2: stale continuable subagents exceeding inactivity threshold (oldest-first)
   * 3. Priority 3: main sessions (only if cleanMain is enabled)
   * Pinned sessions and active running subagents are whitelisted and never evicted.
   */
  enforceCapacityRecycling({ cleanMain = false } = {}) {
    if (this.sessions.size <= this.maxCapacity) return

    const now = Date.now()
    const candidatesTier1 = []
    const candidatesTier2 = []
    const candidatesTier3 = []

    for (const entry of this.sessions.values()) {
      if (entry.isPinned) continue // Pin Whitelist protection
      if (entry.status === 'active' && entry.mode !== 'continuable') continue // Active worker protection

      // Tier 1: completed one-shot subagents
      if (entry.mode === 'one-shot' && entry.status === 'completed') {
        candidatesTier1.push(entry)
      }
      // Tier 2: stale continuable subagents
      else if (
        entry.mode === 'continuable' &&
        now - entry.lastActivityAt >= this.inactivityThresholdMs
      ) {
        candidatesTier2.push(entry)
      }
      // Tier 3: main sessions (if allowed)
      else if (cleanMain && entry.mode === 'main') {
        candidatesTier3.push(entry)
      }
    }

    // Oldest-first sort comparator
    const sortByOldest = (a, b) => (a.completedAt || a.lastActivityAt) - (b.completedAt || b.lastActivityAt)
    candidatesTier1.sort(sortByOldest)
    candidatesTier2.sort(sortByOldest)
    candidatesTier3.sort(sortByOldest)

    const evictionQueue = [...candidatesTier1, ...candidatesTier2, ...candidatesTier3]

    while (this.sessions.size > this.maxCapacity && evictionQueue.length > 0) {
      const victim = evictionQueue.shift()
      this.archive(victim.id).catch((err) => {
        console.debug('[SessionLifecycle] capacity eviction warning:', err?.message || err)
      })
      // For immediate memory reclamation in Map
      this.sessions.delete(victim.id)
    }
  }

  /**
   * Safely purges an entry from session_projcache.json file if present.
   *
   * @param {string} sessionId
   * @param {string} cachePath
   */
  purgeFromProjCache(sessionId, cachePath) {
    try {
      if (!fs.existsSync(cachePath)) return
      const raw = fs.readFileSync(cachePath, 'utf-8')
      let data = JSON.parse(raw)

      let changed = false
      if (Array.isArray(data)) {
        const initialLen = data.length
        data = data.filter((item) => (item?.id || item?.sessionId) !== sessionId)
        changed = data.length !== initialLen
      } else if (data && typeof data === 'object') {
        if (sessionId in data) {
          delete data[sessionId]
          changed = true
        } else if (data.sessions && Array.isArray(data.sessions)) {
          const initialLen = data.sessions.length
          data.sessions = data.sessions.filter((item) => (item?.id || item?.sessionId) !== sessionId)
          changed = data.sessions.length !== initialLen
        }
      }

      if (changed) {
        fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf-8')
      }
    } catch (err) {
      console.debug('[SessionLifecycle] purgeFromProjCache skipped:', err?.message || err)
    }
  }

  /**
   * Periodic reconciliation: archives completed sessions exceeding grace period,
   * and purges expired retention files.
   */
  async reconcile() {
    const now = Date.now()
    const toArchive = []

    for (const [id, entry] of this.sessions.entries()) {
      if (entry.status === 'completed' && entry.completedAt) {
        if (now - entry.completedAt >= this.gracePeriodMs) {
          toArchive.push(id)
        }
      }
    }

    for (const id of toArchive) {
      await this.archive(id)
    }

    this.enforceCapacityRecycling()
  }

  /**
   * Cancels all timers and clears tracked sessions.
   */
  dispose() {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer)
      this.reconcileTimer = null
    }

    for (const [, entry] of this.sessions.entries()) {
      if (entry.timer) {
        clearTimeout(entry.timer)
        entry.timer = null
      }
      if (entry.retentionTimer) {
        clearTimeout(entry.retentionTimer)
        entry.retentionTimer = null
      }
    }
    this.sessions.clear()
  }

  /**
   * Returns current active/pending counts.
   */
  getStats() {
    let active = 0
    let completed = 0
    let archived = 0
    let pinned = 0
    for (const [, entry] of this.sessions.entries()) {
      if (entry.status === 'active') active++
      if (entry.status === 'completed') completed++
      if (entry.status === 'archived') archived++
      if (entry.isPinned) pinned++
    }
    return {
      total: active + completed,
      active,
      completed,
      archived,
      pinned,
    }
  }
}
