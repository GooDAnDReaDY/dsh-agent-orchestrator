import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  getDefaultRoles,
  getDefaultScenarios,
  validateScenario,
  ROLE_IDS,
} from '../lib/pipeline/scenarios.js'

describe('Scenarios and Role Configurations', () => {
  it('provides all 12 default roles with required metadata and system prompts', () => {
    const roles = getDefaultRoles()
    const expectedRoleKeys = [
      ROLE_IDS.SPEC,
      ROLE_IDS.ARCHITECTURE,
      ROLE_IDS.UI_DESIGN,
      ROLE_IDS.FRONTEND,
      ROLE_IDS.BACKEND,
      ROLE_IDS.FULLSTACK,
      ROLE_IDS.QA_TESTS,
      ROLE_IDS.BUGFIX,
      ROLE_IDS.DOCS,
      ROLE_IDS.REFACTORING,
      ROLE_IDS.RESEARCH,
      ROLE_IDS.DEVOPS,
    ]

    for (const key of expectedRoleKeys) {
      assert.ok(roles[key], `Missing role: ${key}`)
      assert.ok(roles[key].id, `Role ${key} missing id`)
      assert.ok(roles[key].name, `Role ${key} missing name`)
      assert.ok(roles[key].systemPrompt, `Role ${key} missing systemPrompt`)
      assert.ok(roles[key].defaultModel?.model, `Role ${key} missing model`)
      assert.ok(roles[key].reasoningEffort, `Role ${key} missing reasoningEffort`)
    }
  })

  it('validates that all default scenarios form cycle-free DAGs and assign valid roles', () => {
    const roles = getDefaultRoles()
    const scenarios = getDefaultScenarios()

    for (const [scenarioId, scenario] of Object.entries(scenarios)) {
      assert.doesNotThrow(
        () => validateScenario(scenario),
        `Scenario ${scenarioId} failed graph validation`
      )

      for (const stage of scenario.stages) {
        assert.ok(roles[stage.roleId], `Stage ${stage.id} references undefined role: ${stage.roleId}`)
      }
    }
  })

  it('ensures backend and frontend/design are strictly separated in complex/enterprise scenarios', () => {
    const scenarios = getDefaultScenarios()
    const complex = scenarios.complex

    const designStage = complex.stages.find((s) => s.roleId === ROLE_IDS.UI_DESIGN)
    const codeStage = complex.stages.find((s) => s.roleId === ROLE_IDS.FRONTEND || s.roleId === ROLE_IDS.CODE)

    assert.ok(designStage, 'Complex scenario must include distinct UI design stage')
    assert.ok(codeStage, 'Complex scenario must include distinct code stage')
    assert.notEqual(designStage.id, codeStage.id, 'Design and Code must NEVER be the same stage')
  })
})

