/**
 * Dispatch Snapshots & One-Click Save as Preset Engine (Issue #109).
 *
 * Implements:
 * 1. Atomic snapshot storage in ~/.dsh/orchestrator-snapshots/ (or configured dir).
 * 2. FIFO retention policy with a 200-item hard ceiling.
 * 3. Atomic writes via .tmp files and atomic rename to prevent corruption.
 * 4. Save as Preset method for turning any completed dispatch run into a reusable preset.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'

export const DEFAULT_MAX_SNAPSHOTS = 200

export class SnapshotManager {
  constructor({ baseDir, maxSnapshots = DEFAULT_MAX_SNAPSHOTS } = {}) {
    this.baseDir = baseDir || path.join(os.homedir(), '.dsh', 'orchestrator-snapshots')
    this.maxSnapshots = maxSnapshots
    this._ensureDir()
  }

  _ensureDir() {
    try {
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true })
      }
    } catch (err) {
      console.error(`[SnapshotManager] Failed to create baseDir ${this.baseDir}:`, err?.message || err)
    }
  }

  /**
   * Lists all recorded snapshots sorted newest to oldest.
   * @returns {Array<object>}
   */
  listSnapshots() {
    this._ensureDir()
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
          console.warn(`[SnapshotManager] Skipping invalid snapshot file ${file}:`, err?.message || err)
        }
      }

      // Sort descending by timestamp / createdAt
      snapshots.sort((a, b) => {
        const timeA = new Date(a.createdAt || a.timestamp || 0).getTime()
        const timeB = new Date(b.createdAt || b.timestamp || 0).getTime()
        return timeB - timeA
      })

      return snapshots
    } catch (err) {
      console.error('[SnapshotManager] Error listing snapshots:', err?.message || err)
      return []
    }
  }

  /**
   * Retrieves a snapshot by ID.
   * @param {string} snapshotId
   * @returns {object|null}
   */
  getSnapshot(snapshotId) {
    if (!snapshotId) return null
    const filePath = path.join(this.baseDir, `${snapshotId}.json`)
    if (!fs.existsSync(filePath)) return null
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      return JSON.parse(content)
    } catch (err) {
      console.error(`[SnapshotManager] Error reading snapshot ${snapshotId}:`, err?.message || err)
      return null
    }
  }

  /**
   * Creates a snapshot atomically.
   * @param {object} snapshotData
   * @returns {object} The created snapshot metadata
   */
  createSnapshot(snapshotData = {}) {
    this._ensureDir()

    const snapshotId = snapshotData.id || `snap-${Date.now()}-${randomUUID().slice(0, 8)}`
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

    const filePath = path.join(this.baseDir, `${snapshotId}.json`)
    const tmpPath = path.join(this.baseDir, `${snapshotId}.tmp-${Date.now()}`)

    try {
      fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf8')
      fs.renameSync(tmpPath, filePath)
    } catch (err) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
      } catch (_) {
        // Safe ignore
      }
      throw err
    }

    // Enforce FIFO retention policy: if file count > maxSnapshots, prune oldest
    this._enforceRetention()

    return record
  }

  /**
   * Prunes oldest snapshot files when total exceeds maxSnapshots ceiling.
   */
  _enforceRetention() {
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
          console.warn(`[SnapshotManager] Failed to prune old snapshot ${fileStats[i].file}:`, err?.message || err)
        }
      }
    } catch (err) {
      console.warn('[SnapshotManager] Retention enforcement error:', err?.message || err)
    }
  }

  /**
   * Converts a snapshot into a reusable scenario/preset structure.
   * @param {string} snapshotId
   * @param {object} [overrides] Custom name/description
   * @returns {object} Preset configuration object
   */
  saveAsPreset(snapshotId, overrides = {}) {
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
