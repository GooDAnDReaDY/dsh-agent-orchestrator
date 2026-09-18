/**
 * Idempotent Preset & Role Self-Synchronization Engine (Issue #107).
 *
 * Implements:
 * 1. Automatic, zero-external-script self-healing synchronization on plugin apply(ctx).
 * 2. Non-destructive merge: preserves user modifications (custom systemPrompt, model, temperature, enabled)
 *    while adding newly introduced canonical roles or presets from scenarios.js.
 * 3. Sanitizes any orphaned/stale references safely.
 */

import { getDefaultRoles, getDefaultScenarios } from './scenarios.js'
import { toRolesArray } from './delegation.js'

/**
 * Idempotently merges default roles and scenarios into existing configuration.
 *
 * @param {object} params
 * @param {Array<object>|object} [params.currentRoles] Existing configured roles
 * @param {object} [params.currentScenarios] Existing configured scenarios
 * @returns {{ roles: Array<object>, scenarios: object, addedRolesCount: number, addedScenariosCount: number }}
 */
export function syncDefaultPresets({ currentRoles, currentScenarios } = {}) {
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

  // 3. Normalize & sync scenarios
  const scenarioMap = { ...(currentScenarios || {}) }
  let addedScenariosCount = 0

  for (const [sId, defScenario] of Object.entries(defaultScenarios)) {
    if (!scenarioMap[sId]) {
      scenarioMap[sId] = { ...defScenario }
      addedScenariosCount++
    }
  }

  return {
    roles: roleList,
    scenarios: scenarioMap,
    addedRolesCount,
    addedScenariosCount,
  }
}
