/**
 * Dispatch Snapshots & One-Click Save as Preset Engine (Issue #109).
 * Security Hardened against Path Traversal (Issue #135).
 * Migrated to ctx.logger (Issue #130).
 *
 * Implements:
 * 1. Atomic snapshot storage in ~/.dsh/orchestrator-snapshots/ (or configured dir).
 * 2. FIFO retention policy with a 200-item hard ceiling.
 * 3. Atomic writes via .tmp files and atomic rename to prevent corruption.
 * 4. Save as Preset method for turning any completed dispatch run into a reusable preset.
 * 5. Strict path traversal verification and snapshot ID sanitization.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'

export const DEFAULT_MAX_SNAPSHOTS = 200

export class SnapshotManager {
  constructor({ baseDir, maxSnapshots = DEFAULT_MAX_SNAPSHOTS, logger } = {}) {
    this.baseDir = baseDir || path.join(os.homedir(), '.dsh', 'orchestrator-snapshots')
    this.maxSnapshots = maxSnapshots
    this.logger = logger || null
    this._snapshotsCache = null
    this._ensureDir()
  }

  _ensureDir() {
    try {
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true })
      }
    } catch (err) {
      if (this.logger?.error) {
        this.logger.error(`[SnapshotManager] Failed to create baseDir ${this.baseDir}:`, err?.message || err)
      }
    }
  }

  /**
   * Resolves and verifies that a snapshotId stays strictly within baseDir.
   * @param {string} snapshotId
   * @returns {string} Absolute resolved file path
   * @throws {Error} If snapshotId contains illegal characters, path separators, or escapes baseDir
   */
  _pathFor(snapshotId) {
    if (!snapshotId || typeof snapshotId !== 'string') {
      throw new Error('Invalid snapshotId: must be a non-empty string')
    }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(snapshotId)) {
      throw new Error(`Invalid snapshotId: "${snapshotId}" contains illegal characters or invalid length`)
    }
    const baseResolved = path.resolve(this.baseDir)
    const resolved = path.resolve(this.baseDir, `${snapshotId}.json`)
    if (!resolved.startsWith(baseResolved + path.sep)) {
      throw new Error(`Path traversal attempt detected in snapshotId: "${snapshotId}"`)
    }
    return resolved
  }

  /**
   * Lists all recorded snapshots sorted newest to oldest.
   * @returns {Array<object>}
   */
  listSnapshots() {
    this._ensureDir()
    if (this._snapshotsCache) {
      return [...this._snapshotsCache]
    }
    try {
      const files = fs.readdirSync(this.baseDir)
      const snapshots = []

      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const filePath = path.join(this.baseDir, file)
        try {
          const content = fs.readFileSync(filePath, 'utf8')
          const data = JSON.parse(content)
          snapshots.push(data)
        } catch (err) {
          // Ignore corrupt files during listing
          if (this.logger?.warn) {
            this.logger.warn(`[SnapshotManager] Skipping invalid snapshot file ${file}:`, err?.message || err)
          }
        }
      }

      // Sort descending by timestamp / createdAt
      snapshots.sort((a, b) => {
        const timeA = new Date(a.createdAt || a.timestamp || 0).getTime()
        const timeB = new Date(b.createdAt || b.timestamp || 0).getTime()
        return timeB - timeA
      })

      this._snapshotsCache = snapshots
      return [...snapshots]
    } catch (err) {
      if (this.logger?.error) {
        this.logger.error('[SnapshotManager] Error listing snapshots:', err?.message || err)
      }
      return []
    }
  }

  /**
   * Retrieves a snapshot by ID with path traversal protection.
   * @param {string} snapshotId
   * @returns {object|null}
   */
  getSnapshot(snapshotId) {
    if (!snapshotId) return null
    let filePath
    try {
      filePath = this._pathFor(snapshotId)
    } catch (err) {
      if (this.logger?.warn) {
        this.logger.warn(`[SnapshotManager] Invalid snapshotId rejected: ${err?.message || err}`)
      }
      return null
    }

    if (!fs.existsSync(filePath)) return null
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      return JSON.parse(content)
    } catch (err) {
      if (this.logger?.error) {
        this.logger.error(`[SnapshotManager] Error reading snapshot ${snapshotId}:`, err?.message || err)
      }
      return null
    }
  }

  /**
   * Creates a snapshot atomically with path traversal protection.
   * @param {object} snapshotData
   * @returns {object} The created snapshot metadata
   */
  createSnapshot(snapshotData = {}) {
    this._ensureDir()

    const snapshotId = snapshotData.id || `snap-${Date.now()}-${randomUUID().slice(0, 8)}`
    const filePath = this._pathFor(snapshotId)
    const nowIso = new Date().toISOString()

    const record = {
      id: snapshotId,
      createdAt: nowIso,
      title: snapshotData.title || `Snapshot ${snapshotId}`,
      scenarioId: snapshotData.scenarioId || 'custom',
      status: snapshotData.status || 'completed',
      modelOverrides: snapshotData.modelOverrides || {},
      stages: snapshotData.stages || [],
      roles: snapshotData.roles || [],
      totalCostUsd: snapshotData.totalCostUsd || 0,
      durationMs: snapshotData.durationMs || 0,
      metadata: snapshotData.metadata || {},
    }

    const tmpPath = path.join(this.baseDir, `${snapshotId}.tmp-${Date.now()}`)

    try {
      fs.writeFileSync(tmpPath, JSON.stringify(record), 'utf8')
      fs.renameSync(tmpPath, filePath)
    } catch (err) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
      } catch (_) {
        // Safe ignore
      }
      throw err
    }

    this._snapshotsCache = null
    // Enforce FIFO retention policy: if file count > maxSnapshots, prune oldest
    this._enforceRetention()

    return record
  }

  /**
   * Prunes oldest snapshot files when total exceeds maxSnapshots ceiling.
   */
  _enforceRetention() {
    this._snapshotsCache = null
    try {
      const files = fs.readdirSync(this.baseDir).filter((f) => f.endsWith('.json'))
      if (files.length <= this.maxSnapshots) return

      const fileStats = files.map((file) => {
        const fullPath = path.join(this.baseDir, file)
        const stat = fs.statSync(fullPath)
        return { file, fullPath, mtime: stat.mtimeMs }
      })

      // Sort ascending (oldest first)
      fileStats.sort((a, b) => a.mtime - b.mtime)

      const removeCount = fileStats.length - this.maxSnapshots
      for (let i = 0; i < removeCount; i++) {
        try {
          fs.unlinkSync(fileStats[i].fullPath)
        } catch (err) {
          if (this.logger?.warn) {
            this.logger.warn(`[SnapshotManager] Failed to prune old snapshot ${fileStats[i].file}:`, err?.message || err)
          }
        }
      }
    } catch (err) {
      if (this.logger?.warn) {
        this.logger.warn('[SnapshotManager] Retention enforcement error:', err?.message || err)
      }
    }
  }

  /**
   * Converts a snapshot into a reusable scenario/preset structure.
   * @param {string} snapshotId
   * @param {object} [overrides] Custom name/description
   * @returns {object} Preset configuration object
   */
  saveAsPreset(snapshotId, overrides = {}) {
    this._pathFor(snapshotId)
    const snapshot = this.getSnapshot(snapshotId)
    if (!snapshot) {
      throw new Error(`Snapshot "${snapshotId}" not found`)
    }

    const presetId = overrides.id || `preset-${snapshot.scenarioId || 'custom'}-${Date.now().toString(36)}`
    const presetName = overrides.name || overrides.title || `Preset from ${snapshot.title || snapshotId}`
    const presetDescription = overrides.description || `Generated from snapshot ${snapshotId} at ${new Date().toISOString()}`

    return {
      id: presetId,
      name: presetName,
      description: presetDescription,
      scenarioId: snapshot.scenarioId || 'custom',
      stages: snapshot.stages || [],
      modelOverrides: snapshot.modelOverrides || {},
      createdAt: new Date().toISOString(),
      sourceSnapshotId: snapshotId,
    }
  }
}
