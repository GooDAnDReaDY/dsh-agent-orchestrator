/**
 * Idempotent Preset & Role Self-Synchronization Engine (Issue #107).
 * Runtime Scenario Validation Connected (Issue #132).
 *
 * Implements:
 * 1. Automatic, zero-external-script self-healing synchronization on plugin apply(ctx).
 * 2. Non-destructive merge: preserves user modifications (custom systemPrompt, model, temperature, enabled)
 *    while adding newly introduced canonical roles or presets from scenarios.js.
 * 3. Validates scenarios via validateScenario() and filters out corrupt/cyclic scenarios safely.
 * 4. Sanitizes any orphaned/stale references safely.
 */

import { getDefaultRoles, getDefaultScenarios, validateScenario } from './scenarios.js'
import { toRolesArray } from './delegation.js'

/**
 * Idempotently merges default roles and scenarios into existing configuration.
 *
 * @param {object} params
 * @param {Array<object>|object} [params.currentRoles] Existing configured roles
 * @param {object} [params.currentScenarios] Existing configured scenarios
 * @param {object} [params.logger] Optional logger for diagnostics
 * @returns {{ roles: Array<object>, scenarios: object, addedRolesCount: number, addedScenariosCount: number }}
 */
export function syncDefaultPresets({ currentRoles, currentScenarios, logger } = {}) {
  const defaultRoles = toRolesArray(getDefaultRoles())
  const defaultScenarios = getDefaultScenarios()

  // 1. Normalize current roles
  const roleList = toRolesArray(currentRoles)
  const existingRoleIds = new Set(roleList.map((r) => r.id))
  let addedRolesCount = 0

  // 2. Add missing default roles without mutating existing ones
  for (const defRole of defaultRoles) {
    if (!existingRoleIds.has(defRole.id)) {
      roleList.push({ ...defRole, enabled: defRole.enabled !== false })
      existingRoleIds.add(defRole.id)
      addedRolesCount++
    }
  }

  // 3. Normalize, validate & sync scenarios
  const scenarioMap = {}
  if (currentScenarios && typeof currentScenarios === 'object') {
    for (const [sId, sc] of Object.entries(currentScenarios)) {
      if (sc && typeof sc === 'object' && sc.id) {
        if (Array.isArray(sc.stages) && sc.stages.length > 0) {
          try {
            validateScenario(sc)
          } catch (err) {
            if (logger?.warn) {
              logger.warn(`[PresetSync] Discarding invalid existing scenario "${sId}": ${err.message}`)
            }
            continue
          }
        }
        scenarioMap[sId] = sc
      }
    }
  }

  let addedScenariosCount = 0
  for (const [sId, defScenario] of Object.entries(defaultScenarios)) {
    if (!scenarioMap[sId]) {
      try {
        validateScenario(defScenario)
        scenarioMap[sId] = { ...defScenario }
        addedScenariosCount++
      } catch (err) {
        if (logger?.error) {
          logger.error(`[PresetSync] Default scenario "${sId}" failed validation: ${err.message}`)
        }
      }
    }
  }

  return {
    roles: roleList,
    scenarios: scenarioMap,
    addedRolesCount,
    addedScenariosCount,
  }
}
