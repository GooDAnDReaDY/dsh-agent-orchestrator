import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ROLE_INPUT_ALIASES,
  resolveTargetRole,
  toRolesArray,
} from '../lib/pipeline/delegation.js'
import {
  inferScenarioComplexity,
  COMPLEXITY_TRIGGERS,
} from '../lib/pipeline/decomposer.js'
import { getDefaultRoles } from '../lib/pipeline/scenarios.js'

describe('Batch 7: Issue #133 - Russian Functional Input Parsing Data & Aliases', () => {
  const rolesList = toRolesArray(getDefaultRoles())

  it('ROLE_INPUT_ALIASES maps Russian specialist synonyms accurately', () => {
    assert.equal(ROLE_INPUT_ALIASES['разработчик'], 'code')
    assert.equal(ROLE_INPUT_ALIASES['программист'], 'code')
    assert.equal(ROLE_INPUT_ALIASES['код'], 'code')

    assert.equal(ROLE_INPUT_ALIASES['тестировщик'], 'qa_tests')
    assert.equal(ROLE_INPUT_ALIASES['ревьюер'], 'qa_tests')
    assert.equal(ROLE_INPUT_ALIASES['тесты'], 'qa_tests')

    assert.equal(ROLE_INPUT_ALIASES['архитектор'], 'architecture')
    assert.equal(ROLE_INPUT_ALIASES['архитектура'], 'architecture')

    assert.equal(ROLE_INPUT_ALIASES['документатор'], 'docs')
    assert.equal(ROLE_INPUT_ALIASES['документация'], 'docs')
    assert.equal(ROLE_INPUT_ALIASES['доки'], 'docs')

    assert.equal(ROLE_INPUT_ALIASES['тз'], 'spec')
    assert.equal(ROLE_INPUT_ALIASES['спецификация'], 'spec')

    assert.equal(ROLE_INPUT_ALIASES['дизайнер'], 'ui_design')
    assert.equal(ROLE_INPUT_ALIASES['дизайн'], 'ui_design')

    assert.equal(ROLE_INPUT_ALIASES['фронтенд'], 'frontend')
    assert.equal(ROLE_INPUT_ALIASES['фронт'], 'frontend')

    assert.equal(ROLE_INPUT_ALIASES['бэкенд'], 'backend')
    assert.equal(ROLE_INPUT_ALIASES['бэк'], 'backend')

    assert.equal(ROLE_INPUT_ALIASES['баг'], 'bugfix')
    assert.equal(ROLE_INPUT_ALIASES['исправление'], 'bugfix')
    assert.equal(ROLE_INPUT_ALIASES['фикс'], 'bugfix')

    assert.equal(ROLE_INPUT_ALIASES['рефакторинг'], 'refactoring')
    assert.equal(ROLE_INPUT_ALIASES['чистка'], 'refactoring')

    assert.equal(ROLE_INPUT_ALIASES['исследование'], 'research')
    assert.equal(ROLE_INPUT_ALIASES['анализ'], 'research')

    assert.equal(ROLE_INPUT_ALIASES['девопс'], 'devops')
    assert.equal(ROLE_INPUT_ALIASES['деплой'], 'devops')
  })

  it('resolveTargetRole: correctly resolves Russian role strings', () => {
    assert.equal(resolveTargetRole('архитектор', rolesList), 'architecture')
    assert.equal(resolveTargetRole('пусть архитектор проверит', rolesList), 'architecture')
    assert.equal(resolveTargetRole('тестировщик', rolesList), 'qa_tests')
    assert.equal(resolveTargetRole('ревьюер', rolesList), 'qa_tests')
    assert.equal(resolveTargetRole('напиши тз', rolesList), 'spec')
    assert.equal(resolveTargetRole('документатор', rolesList), 'docs')
    assert.equal(resolveTargetRole('дизайнер интерфейса', rolesList), 'ui_design')
    assert.equal(resolveTargetRole('фронтенд', rolesList), 'frontend')
    assert.equal(resolveTargetRole('бэкенд', rolesList), 'backend')
    assert.equal(resolveTargetRole('девопс', rolesList), 'devops')
    assert.equal(resolveTargetRole('разработчик', [{ id: 'code' }]), 'code')
    assert.equal(resolveTargetRole('разработчик', rolesList), 'backend')
  })

  it('inferScenarioComplexity: Russian triggers classify task complexity correctly', () => {
    // Complex triggers
    assert.equal(inferScenarioComplexity('создать новый плагин с нуля'), 'complex')
    assert.equal(inferScenarioComplexity('полная архитектура новой системы'), 'complex')
    assert.equal(inferScenarioComplexity('глобальный рефакторинг всего проекта'), 'complex')

    // Simple triggers
    assert.equal(inferScenarioComplexity('поправь опечатку в README'), 'simple')
    assert.equal(inferScenarioComplexity('мелкий баг в валидаторе'), 'simple')
    assert.equal(inferScenarioComplexity('быстро поправь константу'), 'simple')
    assert.equal(inferScenarioComplexity('hotfix таймаута'), 'simple')

    // Balanced / medium fallback
    assert.equal(inferScenarioComplexity('добавить обработку нового события очереди'), 'medium')
  })

  it('COMPLEXITY_TRIGGERS regexes are exported and testable', () => {
    assert.ok(COMPLEXITY_TRIGGERS.complex instanceof RegExp)
    assert.ok(COMPLEXITY_TRIGGERS.simple instanceof RegExp)
    assert.ok(COMPLEXITY_TRIGGERS.complex.test('from scratch'))
    assert.ok(COMPLEXITY_TRIGGERS.simple.test('quick fix'))
  })
})
