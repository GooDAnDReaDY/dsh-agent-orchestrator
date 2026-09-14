/**
 * Directed Acyclic Graph (DAG) Execution Engine for DSH Multi-Agent Pipelines.
 *
 * Implements:
 * - Topological dependency resolution and cycle detection
 * - Concurrency control with dependency-aware scheduling (parallel independent nodes)
 * - Blockers propagation: dependent nodes get marked as 'blocked' if a prerequisite fails
 * - Event hooks: onNodeStart, onNodeComplete, onNodeFail, onNodeBlocked
 * - Pure logic: completely testable without DSH runtime or network
 */

export const NODE_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  BLOCKED: 'blocked',
  SKIPPED: 'skipped',
}

/**
 * Validates stage definitions and checks for circular dependencies.
 * @param {Array<object>} stages List of stages { id, name, dependsOn: string[], roleId, ... }
 * @throws {Error} if stages are invalid or contain cycles
 */
export function validateGraph(stages) {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new Error('Pipeline must have at least one stage')
  }

  const ids = new Set()
  for (const s of stages) {
    if (!s.id || typeof s.id !== 'string') {
      throw new Error(`Invalid stage ID: ${JSON.stringify(s)}`)
    }
    if (ids.has(s.id)) {
      throw new Error(`Duplicate stage ID: ${s.id}`)
    }
    ids.add(s.id)
  }

  // Check that all dependsOn references exist
  for (const s of stages) {
    const deps = s.dependsOn || []
    for (const dep of deps) {
      if (!ids.has(dep)) {
        throw new Error(`Stage "${s.id}" depends on non-existent stage "${dep}"`)
      }
      if (dep === s.id) {
        throw new Error(`Stage "${s.id}" cannot depend on itself`)
      }
    }
  }

  // Cycle detection via DFS
  const visited = new Map() // id -> 0 (unvisited), 1 (visiting), 2 (visited)
  const adj = new Map()
  for (const s of stages) {
    visited.set(s.id, 0)
    adj.set(s.id, s.dependsOn || [])
  }

  function dfs(nodeId, path = []) {
    visited.set(nodeId, 1)
    const currentPath = [...path, nodeId]
    const neighbors = adj.get(nodeId) || []
    for (const n of neighbors) {
      const state = visited.get(n)
      if (state === 1) {
        const cycle = [...currentPath.slice(currentPath.indexOf(n)), n].join(' -> ')
        throw new Error(`Circular dependency detected: ${cycle}`)
      }
      if (state === 0) {
        dfs(n, currentPath)
      }
    }
    visited.set(nodeId, 2)
  }

  for (const s of stages) {
    if (visited.get(s.id) === 0) {
      dfs(s.id)
    }
  }

  return true
}

/**
 * Returns stages whose dependencies are 100% completed.
 */
export function getRunnableStages(stages, stateMap) {
  return stages.filter((s) => {
    const currentState = stateMap.get(s.id)?.status || NODE_STATUS.PENDING
    if (currentState !== NODE_STATUS.PENDING) {
      return false
    }
    const deps = s.dependsOn || []
    return deps.every((d) => stateMap.get(d)?.status === NODE_STATUS.COMPLETED)
  })
}

/**
 * Identifies stages blocked by upstream failures.
 */
export function markBlockedStages(stages, stateMap) {
  let changed = false
  for (const s of stages) {
    const state = stateMap.get(s.id)
    if (state.status === NODE_STATUS.PENDING) {
      const deps = s.dependsOn || []
      const failedDep = deps.find((d) => {
        const ds = stateMap.get(d)?.status
        return ds === NODE_STATUS.FAILED || ds === NODE_STATUS.BLOCKED
      })
      if (failedDep) {
        state.status = NODE_STATUS.BLOCKED
        state.blockedBy = failedDep
        state.error = `Blocked due to failure of upstream stage: ${failedDep}`
        changed = true
      }
    }
  }
  return changed
}

/**
 * Executes a pipeline of stages respecting DAG dependencies, concurrency, and blockers.
 *
 * @param {object} options
 * @param {Array<object>} options.stages
 * @param {function} options.executor async (stage, context) => stageResult
 * @param {number} [options.concurrency=4] max parallel tasks
 * @param {object} [options.initialContext={}]
 * @param {function} [options.onNodeStart]
 * @param {function} [options.onNodeComplete]
 * @param {function} [options.onNodeFail]
 * @param {function} [options.onNodeBlocked]
 * @returns {Promise<object>} execution summary { success, stateMap, artifacts, durationMs }
 */
export async function executeDAG({
  stages,
  executor,
  concurrency = 4,
  initialContext = {},
  onNodeStart = () => {},
  onNodeComplete = () => {},
  onNodeFail = () => {},
  onNodeBlocked = () => {},
}) {
  validateGraph(stages)

  const startTime = Date.now()
  const stateMap = new Map()
  const artifacts = new Map() // stageId -> artifact output

  for (const s of stages) {
    stateMap.set(s.id, {
      id: s.id,
      name: s.name || s.id,
      roleId: s.roleId,
      status: NODE_STATUS.PENDING,
      dependsOn: s.dependsOn || [],
      startedAt: null,
      completedAt: null,
      durationMs: 0,
      output: null,
      error: null,
      metrics: null,
    })
  }

  let runningCount = 0
  let isDone = false

  return new Promise((resolvePromise, rejectPromise) => {
    function checkCompletion() {
      const allDone = stages.every((s) => {
        const st = stateMap.get(s.id).status
        return st === NODE_STATUS.COMPLETED || st === NODE_STATUS.FAILED || st === NODE_STATUS.BLOCKED || st === NODE_STATUS.SKIPPED
      })

      if (allDone && runningCount === 0 && !isDone) {
        isDone = true
        const hasFailures = stages.some((s) => {
          const st = stateMap.get(s.id).status
          return st === NODE_STATUS.FAILED || st === NODE_STATUS.BLOCKED
        })
        resolvePromise({
          success: !hasFailures,
          durationMs: Date.now() - startTime,
          stateMap: Object.fromEntries(stateMap),
          artifacts: Object.fromEntries(artifacts),
        })
      }
    }

    function triggerNext() {
      if (isDone) return

      // Propagate blockers first
      if (markBlockedStages(stages, stateMap)) {
        for (const s of stages) {
          const st = stateMap.get(s.id)
          if (st.status === NODE_STATUS.BLOCKED && !st.notifiedBlocked) {
            st.notifiedBlocked = true
            onNodeBlocked(st)
          }
        }
      }

      // Find runnable candidates
      const runnable = getRunnableStages(stages, stateMap)

      while (runnable.length > 0 && runningCount < concurrency) {
        const nextStage = runnable.shift()
        const nodeState = stateMap.get(nextStage.id)
        nodeState.status = NODE_STATUS.RUNNING
        nodeState.startedAt = Date.now()
        runningCount++

        onNodeStart(nodeState)

        // Run task asynchronously
        const upstreamOutputs = {}
        for (const dep of nextStage.dependsOn || []) {
          upstreamOutputs[dep] = artifacts.get(dep)
        }

        const runContext = {
          ...initialContext,
          upstreamOutputs,
          allArtifacts: Object.fromEntries(artifacts),
        }

        Promise.resolve()
          .then(() => executor(nextStage, runContext))
          .then((result) => {
            nodeState.status = NODE_STATUS.COMPLETED
            nodeState.completedAt = Date.now()
            nodeState.durationMs = nodeState.completedAt - nodeState.startedAt
            nodeState.output = result?.output ?? result
            nodeState.metrics = result?.metrics ?? null

            artifacts.set(nextStage.id, nodeState.output)
            runningCount--
            onNodeComplete(nodeState)
            triggerNext()
          })
          .catch((err) => {
            nodeState.status = NODE_STATUS.FAILED
            nodeState.completedAt = Date.now()
            nodeState.durationMs = nodeState.completedAt - nodeState.startedAt
            nodeState.error = err?.message || String(err)

            runningCount--
            onNodeFail(nodeState, err)
            triggerNext()
          })
      }

      checkCompletion()
    }

    // Initial trigger
    triggerNext()
  })
}

