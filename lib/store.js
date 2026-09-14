/**
 * Pipeline & Metrics Store for DSH Multi-Agent Orchestrator.
 *
 * In-memory state with JSON persistence for recovery across turns.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export class OrchestratorStore {
  constructor(options = {}) {
    const baseDir = options.storageDir || join(homedir(), '.dsh')
    this.storagePath = join(baseDir, 'orchestrator-pipelines.json')
    this.pipelines = new Map()
    this.globalMetrics = {
      totalPipelines: 0,
      completedPipelines: 0,
      failedPipelines: 0,
      totalPromptTokens: 0,
      totalCacheHitTokens: 0,
      totalCacheMissTokens: 0,
      overallHitRatio: 0,
      totalDurationMs: 0,
    }
    this._load()
  }

  _load() {
    try {
      if (existsSync(this.storagePath)) {
        const raw = readFileSync(this.storagePath, 'utf8')
        const data = JSON.parse(raw)
        if (Array.isArray(data.pipelines)) {
          for (const p of data.pipelines) {
            this.pipelines.set(p.pipelineId, p)
          }
        }
        if (data.globalMetrics) {
          this.globalMetrics = { ...this.globalMetrics, ...data.globalMetrics }
        }
      }
    } catch (e) {
      console.warn('[dsh-agent-orchestrator] Store load warning:', e?.message || e)
    }
  }

  save() {
    try {
      mkdirSync(dirname(this.storagePath), { recursive: true })
      const serialized = {
        pipelines: Array.from(this.pipelines.values()).slice(-50), // keep last 50
        globalMetrics: this.globalMetrics,
        updatedAt: Date.now(),
      }
      writeFileSync(this.storagePath, JSON.stringify(serialized, null, 2), 'utf8')
    } catch (e) {
      console.warn('[dsh-agent-orchestrator] Store save warning:', e?.message || e)
    }
  }

  recordPipeline(pipelineData) {
    this.pipelines.set(pipelineData.pipelineId, pipelineData)
    this.globalMetrics.totalPipelines++
    this.save()
  }

  updatePipeline(pipelineId, updateFnOrPartial) {
    const existing = this.pipelines.get(pipelineId)
    if (existing) {
      const updated = typeof updateFnOrPartial === 'function'
        ? (updateFnOrPartial(existing) || existing)
        : { ...existing, ...updateFnOrPartial }
      this.pipelines.set(pipelineId, updated)

      if (updated.status === 'completed' && existing.status !== 'completed') {
        this.globalMetrics.completedPipelines++
        this.globalMetrics.totalDurationMs += (updated.durationMs || 0)
      } else if (updated.status === 'failed' && existing.status !== 'failed') {
        this.globalMetrics.failedPipelines++
      }

      this.save()
      return updated
    }
    return null
  }

  updateStage(pipelineId, stageId, updateFnOrPartial) {
    const pipeline = this.pipelines.get(pipelineId)
    if (!pipeline) return null

    if (!pipeline.stateMap) pipeline.stateMap = {}
    const existing = pipeline.stateMap[stageId] || { id: stageId, status: 'pending' }
    const updated = typeof updateFnOrPartial === 'function'
      ? (updateFnOrPartial(existing) || existing)
      : { ...existing, ...updateFnOrPartial }

    pipeline.stateMap[stageId] = updated

    if (Array.isArray(pipeline.stages)) {
      const idx = pipeline.stages.findIndex((s) => s.id === stageId)
      if (idx !== -1) {
        pipeline.stages[idx] = { ...pipeline.stages[idx], ...updated }
      }
    }

    this.save()
    return updated
  }

  appendStageLog(pipelineId, stageId, logDelta) {
    const pipeline = this.pipelines.get(pipelineId)
    if (!pipeline) return
    if (!pipeline.stageLogs) pipeline.stageLogs = {}
    if (!pipeline.stageLogs[stageId]) pipeline.stageLogs[stageId] = ''
    pipeline.stageLogs[stageId] += String(logDelta || '')
  }

  recordCompletion(pipelineId, summary) {
    const p = this.pipelines.get(pipelineId)
    if (p) {
      p.status = summary.success ? 'completed' : 'failed'
      p.completedAt = Date.now()
      p.durationMs = summary.durationMs || 0
      p.stateMap = summary.stateMap || {}
      p.artifacts = summary.artifacts || {}

      if (summary.success) {
        this.globalMetrics.completedPipelines++
      } else {
        this.globalMetrics.failedPipelines++
      }

      this.globalMetrics.totalDurationMs += p.durationMs

      // Aggregate cache metrics across all stages
      for (const node of Object.values(summary.stateMap || {})) {
        const m = node.metrics
        if (m) {
          this.globalMetrics.totalPromptTokens += m.promptTokens || 0
          this.globalMetrics.totalCacheHitTokens += m.cacheHitTokens || 0
          this.globalMetrics.totalCacheMissTokens += m.cacheMissTokens || 0
        }
      }

      if (this.globalMetrics.totalPromptTokens > 0) {
        this.globalMetrics.overallHitRatio = parseFloat(
          (this.globalMetrics.totalCacheHitTokens / this.globalMetrics.totalPromptTokens).toFixed(4)
        )
      }

      this.save()
    }
  }

  getPipeline(pipelineId) {
    return this.pipelines.get(pipelineId) || null
  }

  getActivePipelines() {
    return Array.from(this.pipelines.values()).filter(
      (p) => p.status === 'running' || p.status === 'pending'
    )
  }

  getAllPipelines() {
    return Array.from(this.pipelines.values()).sort((a, b) => b.createdAt - a.createdAt)
  }

  getMetrics() {
    return { ...this.globalMetrics }
  }
}
