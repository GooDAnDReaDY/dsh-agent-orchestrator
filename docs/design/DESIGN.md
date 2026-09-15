# DESIGN.md — dsh-agent-orchestrator

## Product / Purpose
- **Назначение**: Оркестратор распределённых мульти-агентных пайплайнов для DeepSeek Harness (DSH). Принимает задачи из чата DSH или из Gitea/Kanban, декомпозирует их на 6 специализированных направлений (код, документация, проектирование, дизайн, ТЗ, тесты) и исполняет в виде направленного ациклического графа (DAG) с учётом блокеров и параллельных веток.
- **Ключевой технический дифференциатор**: Детерминированная структура контекста (Canonical Prefix Layout) и сквозное накопление артефактов (Append-Only Upstream Context) для максимизации Cache Hit (KV Cache / Prompt Caching) у агентов с одинаковыми моделями.
- **Аудитория**: Разработчики, архитекторы и команды, использующие DeepSeek Harness для сложных инженерных задач.
- **Статус**: Development, версия 0.1.0.

## User Surfaces
- **Web UI / Settings Card**:
  - Слот `settings.plugin.item` (пространство `dsh-agent-orchestrator`):
    - Секция 1: Пул агентов (6 ролей: architecture, spec, ui_design, code, qa_tests, docs) с настройкой модели, скиллов и системного промпта.
    - Секция 2: Редактор 3 сценариев (Simple 1-2 этапа, Medium 3-4 этапа, Complex 5-6 этапов) с настройкой блокеров и параллельности.
    - Секция 3: Мониторинг Prompt Caching (процент Cache Hit, сэкономленные токены, выравнивание префиксов).
    - Секция 4: Интеграция с Gitea / Kanban (маппинг колонок, автосоздание подзадач).
- **Web UI / Workflow Visualizer**:
  - Интерактивный виджет графа пайплайна (DAG Viewer) в интерфейсе сессии/чата или в деталях карточки канбана.
- **Инструменты агента (DSH Tools)**:
  - `orchestrator_decompose`: декомпозиция задачи на этапы по выбранному сценарию.
  - `orchestrator_run`: запуск исполнения графа подзадач.
  - `orchestrator_status`: получение текущего состояния, прогресса и метрик кэша.
- **Slash-команды в чате**:
  - `/pipeline <задача>` или `/orchestrate <задача>`.
- **API (HTTP)**:
  - `GET /dsh-agent-orchestrator/status` — текущие активные пайплайны и метрики.
  - `POST /dsh-agent-orchestrator/dispatch` — запуск оркестрации задачи.
  - `GET /dsh-agent-orchestrator/config` — чтение настроек агентов и сценариев.
  - `POST /dsh-agent-orchestrator/config` — обновление настроек.
  - `GET /dsh-agent-orchestrator/cache-stats` — статистика попаданий в кэш.

## Visual Direction
- **Атмосфера**: Строгий, чистый, профессиональный интерфейс в системном стиле DeepSeek Harness (anti-slop).
- **Цвета и токены**: Исключительно переменные темы DSH (`--dsw-alias-bg-layer-3`, `--dsw-alias-border-l2`, `--dsw-alias-label-primary`, `--dsw-alias-label-secondary`, `--dsw-alias-label-tertiary`, акцентные бейджи).
- **Изоляция стилей**: Каждый динамический тег стилей имеет атрибут `data-dsh-plugin="dsh-agent-orchestrator"`. Все селекторы имеют строгий префикс `.dso-`.

## Architecture of Prompt Caching (KV-Cache Optimization)
1. **Static Shared Anchor (Layer 1)**:
   - Общий репозиторный контекст, конвенции проекта и сигнатуры доступных инструментов.
   - Размер >= 1024 токенов (порог включения prompt caching в DeepSeek API).
   - Байт-в-байт идентичен для всех агентов, использующих одну и ту же модель.
2. **Shared Task Anchor (Layer 2)**:
   - Исходный текст задачи пользователя, ссылка на Issue, общий мастер-план.
3. **Cumulative Context (Layer 3)**:
   - Артефакты предшествующих этапов дописываются строго в конец (Append-Only).
   - Следующий этап на той же модели переиспользует 100% KV-кэша предыдущих этапов.
4. **Role Directive (Layer 4)**:
   - Ролевой системный промпт конкретного агента, скиллы и инструкция подзадачи передаются в конце, не разрушая префикс.
5. **Телеметрия кэша**:
   - Перехват `usage.prompt_cache_hit_tokens` и `usage.prompt_cache_miss_tokens` из ответов `ctx.llm.prepareCall().stream()`.
   - Расчёт метрик: Cache Hit Ratio (%), экономия входных токенов (в токенах и USD).

## 3 Сценария сложности
1. **Простой (Simple, 1-2 этапа)**:
   - Этап 1: Код (`code`).
   - Этап 2: Тесты (`qa_tests`) + Документация (`docs`) параллельно.
2. **Средний (Medium, 3-4 этапа)**:
   - Этап 1: ТЗ и Архитектура (`spec` -> `architecture`).
   - Этап 2: Код ядра (`code`) параллельно с UI дизайном (`ui_design`).
   - Этап 3: Тестирование (`qa_tests`).
   - Этап 4: Документация (`docs`).
3. **Сложный (Complex, 5-6 этапов)**:
   - Этап 1: ТЗ (`spec`).
   - Этап 2: Архитектура и контракты (`architecture`).
   - Этап 3: UI/UX дизайн (`ui_design`).
   - Этап 4: Реализация кода (`code`).
   - Этап 5: Полный комплекс тестов (`qa_tests`).
   - Этап 6: Техническая документация и релиз-ноутс (`docs`).


## Native Subagent Execution & Safety Architecture

### 1. In-Harness Native Lifecycle (`ctx.subagents`)
- Поддержка нативного жизненного цикла дочерних сессий без внешних CLI-зависимостей.
- Запуск одноразовых воркеров (`mode: 'one-shot'`) через `ctx.subagents.start` и интерактивных воркеров (`mode: 'continuable'`) через `ctx.subagents.startContinuable`.
- Автономный неинтерактивный запуск: жесткая фиксация `approval: 'never'`, предотвращающая зависание фонового процесса при ожидании подтверждения в UI.
- Наследование файловой песочницы (`sandbox scope`) и поддержка скоупинга рабочей директории (`cwd`).

### 2. Модель безопасности Tool Intersection
- Принцип сужения прав:
  $$\text{childTools} = (\text{roleTools} \cap \text{parentTools}) \setminus \{\text{"run\_code"}, \text{delegation\_tools}\} \setminus \text{denyList}$$
- Категорический запрет опасных примитивов выполнения кода (`run_code`, `code_exec`, `system_exec`).
- Барьер против рекурсивного самоделегирования (Anti-Redelegation Shield): запрет `agent_run`, `orchestrator_delegate_specialist`, `delegate`, `list_subagents` для дочерних агентов.
- Принцип `Fail-Loud`: если пересечение инструментов пустое при явном запросе инструментов ролью, запуск блокируется ошибкой `SecurityViolation` до обращения к LLM.

### 3. Декларативный вызов: `agent_run` и `{{subagent_pool}}`
- Модели и человеку доступен лаконичный инструмент `agent_run({ name, task, mode, cwd })`.
- Каталог доступных специалистов автоматически транслируется в системный промпт через секцию `orchestrator:roster` / `{{subagent_pool}}`.

### 4. UI/UX: Нативные слоты DSH
- **Интерактивная карточка вызова (`tool.call.toolview`)**:
  - Карточка для `agent_run` и `orchestrator_delegate_specialist` в ленте чата DSH.
  - Бейдж специалиста, провайдер/модель, статус выполнения (⏳/🟢/🔴) и таймер.
  - Раскрывающийся спойлер **Tool Diff**: список разрешенных (`allowed`), вырезанных безопасностью (`strippedSecurity`) и запрещенных (`denied`) инструментов.
  - Плашка статуса приёмки результата.
- **Индикатор дочерней сессии (`conversation.session.header.utilities`)**:
  - Бейдж в шапке открытой дочерней сессии: `[ 🤖 <Роль> · <Модель> · ⮌ Родитель: #ID ]`.
  - Клик по ссылке мгновенно возвращает пользователя в родительский чат.

## Проверяемость (Testability)
- Движок DAG, нормализатор префиксов кэша, парсер декомпозиции и валидатор сценариев реализованы как чистые модули без зависимостей от сети и харнесса.
- Тестирование: `node --test test/*.test.mjs`.

