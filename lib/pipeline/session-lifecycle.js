/**
 * Subagent Session Lifecycle & Cleanup Manager.
 *
 * Implements Issue #56:
 * 1. Event-based and timer-based auto-archiving of one-shot subagent sessions after
 *    a grace period (default 3 minutes = 180_000 ms).
 * 2. Projection cache cleanup (`session_projcache.json`) to prevent bloat.
 * 3. Background reconciliation audit for orphaned subagents.
 * 4. Safe teardown on plugin deactivation / restart.
 */

import fs from 'fs'
import path from 'path'

export const DEFAULT_GRACE_PERIOD_MS = 3 * 60 * 1000 // 3 minutes
export const DEFAULT_RECONCILE_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

export class SessionLifecycleManager {
  /**
   * @param {object} [options]
   * @param {number} [options.gracePeriodMs=180000]
   * @param {number} [options.reconcileIntervalMs=300000]
   * @param {string} [options.projCachePath]
   * @param {object} [options.subagentsService]
   * @param {object} [options.sessionsService]
   * @param {function} [options.onArchive]
   */
  constructor(options = {}) {
    this.gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS
    this.reconcileIntervalMs = options.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS
    this.projCachePath = options.projCachePath || null
    this.subagentsService = options.subagentsService || null
    this.sessionsService = options.sessionsService || null
    this.onArchive = options.onArchive || null

    /** @type {Map<string, { registeredAt: number, completedAt: number|null, status: string, timer: any, metadata: object }>} */
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
   * Tracks a newly spawned or completed subagent session.
   *
   * @param {string} sessionId
   * @param {object} [metadata]
   */
  register(sessionId, metadata = {}) {
    if (!sessionId) return
    const existing = this.sessions.get(sessionId)
    if (existing) {
      existing.metadata = { ...existing.metadata, ...metadata }
      return
    }

    this.sessions.set(sessionId, {
      registeredAt: Date.now(),
      completedAt: null,
      status: 'active',
      timer: null,
      metadata,
    })
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
      this.register(sessionId, { result })
      entry = this.sessions.get(sessionId)
    }

    entry.completedAt = Date.now()
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
  }

  /**
   * Immediately archives a session, purging from projection cache.
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

    // 2. Synchronous/safe cleanup of session_projcache.json
    if (this.projCachePath) {
      this.purgeFromProjCache(sessionId, this.projCachePath)
    }

    if (typeof this.onArchive === 'function') {
      try {
        this.onArchive(sessionId, entry.metadata)
      } catch (err) {
        console.debug('[SessionLifecycle] onArchive callback error:', err?.message || err)
      }
    }

    this.sessions.delete(sessionId)
    return true
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
   * Periodic reconciliation: archives any completed sessions exceeding grace period.
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
    }
    this.sessions.clear()
  }

  /**
   * Returns current active/pending counts.
   */
  getStats() {
    let active = 0
    let completed = 0
    for (const [, entry] of this.sessions.entries()) {
      if (entry.status === 'active') active++
      if (entry.status === 'completed') completed++
    }
    return {
      total: this.sessions.size,
      active,
      completed,
    }
  }
}
