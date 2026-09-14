/**
 * Kanban & Gitea Integration Bridge for DSH Multi-Agent Orchestrator.
 *
 * Interfaces with @goodandready/dsh-kanban and Gitea issue tracking:
 * - Updates task cards, checklist milestones, and agent badges
 * - Auto-advances cards between workflow columns (e.g. progress -> review -> done)
 * - Safe degradation if dsh-kanban is not installed
 */

export class KanbanBridge {
  constructor(options = {}) {
    this.port = options.port || 3080
    this.fetchImpl = options.fetchImpl || globalThis.fetch
  }

  _url(path) {
    return `http://127.0.0.1:${this.port}${path}`
  }

  async getTask(taskId) {
    if (!taskId) return null
    try {
      const res = await this.fetchImpl(this._url(`/dsh-kanban/task/${encodeURIComponent(taskId)}`), {
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }

  async updateChecklist(taskId, items = []) {
    if (!taskId || !Array.isArray(items)) return false
    try {
      const res = await this.fetchImpl(this._url(`/dsh-kanban/task/${encodeURIComponent(taskId)}/checklist`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
        signal: AbortSignal.timeout(3000),
      })
      return res.ok
    } catch {
      return false
    }
  }

  async moveTask(taskId, columnId) {
    if (!taskId || !columnId) return false
    try {
      const res = await this.fetchImpl(this._url(`/dsh-kanban/task/${encodeURIComponent(taskId)}/move`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnId }),
        signal: AbortSignal.timeout(3000),
      })
      return res.ok
    } catch {
      return false
    }
  }

  async postComment(taskId, commentText) {
    if (!taskId || !commentText) return false
    try {
      const res = await this.fetchImpl(this._url(`/dsh-kanban/task/${encodeURIComponent(taskId)}/comments`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentText, author: 'orchestrator' }),
        signal: AbortSignal.timeout(3000),
      })
      return res.ok
    } catch {
      return false
    }
  }

  /**
   * Syncs stage completion to a linked Kanban task.
   */
  async syncStageProgress(taskId, stage, allStages) {
    if (!taskId) return

    const checklistItems = allStages.map((s) => ({
      id: s.id,
      text: `${s.name || s.id} (${s.roleName || s.roleId})`,
      done: s.status === 'completed',
    }))

    await this.updateChecklist(taskId, checklistItems)

    // If all stages complete, advance card to review or done
    const allDone = allStages.every((s) => s.status === 'completed')
    if (allDone) {
      await this.moveTask(taskId, 'review')
      await this.postComment(
        taskId,
        '🚀 **Multi-Agent Orchestrator Pipeline Completed Successfully!**\nAll stages finished. Ready for human review.'
      )
    }
  }
}

