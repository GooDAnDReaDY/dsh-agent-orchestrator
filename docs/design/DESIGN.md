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



### 5. Security & Guardrails Architecture (Batch 1: Issues #113, #103, #102, #19, #111)

#### 1. Защита HTTP-маршрутов (`lib/http-guard.js`, Issue #113)
- **Fail-closed origin/host check**:
  - Для всех изменяющих состояние маршрутов (`/dispatch`, `/delegate`, `/cancel`, `/config`) обязательна валидация `Origin`, `Host`, `Referer`, `Sec-Fetch-Site`.
  - При отсутствии `Origin` и `Sec-Fetch-Site` доступ разрешается исключительно локальным вызовам loopback (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`).
  - Все неавторизованные или cross-origin запросы немедленно отклоняются со статусом `403 Forbidden` (`no-store`).
- **Строгий лимит размера тела (Payload Bounding)**:
  - Метод `parseBoundedJsonBody` с аппаратным лимитом 1MB (`DEFAULT_MAX_BODY_BYTES = 1048576`).
  - Превышение размера немедленно приостанавливает поток и возвращает `413 Payload Too Large`.
- **Публичный маршрут `/status`**:
  - Осознанно публичный `read-only` эндпоинт. Не принимает тело запроса, не производит мутаций, возвращает только агрегированные обезличенные метрики пайплайнов.

#### 2. Защитный комплекс субагентов (Issues #103, #102, #19)
- **Anti-Redelegation Shield (Issue #103)**:
  - Принудительное вырезание всех инструментов делегирования (`agent_run`, `orchestrator_*`, `delegate`, `list_subagents`) из `toolFilter` любого дочернего воркера.
- **Leaf Experts Bound (Issue #102)**:
  - Специализированные эксперты (воркеры ролей) запускаются со строгим ограничением `maxDepth: 1`. Воркер обязан выполнить изолированную задачу и вернуть отчёт ведущему агенту, исключая каскадное ветвление.
- **Anti-Matryoshka Guard (Issue #19)**:
  - Аппаратный потолок глубины вложенности `HARD_MAX_DEPTH = 3`. При попытке делегирования на 4-м уровне бросается безопасное исключение `DELEGATION_DEPTH_LIMIT_MESSAGE`.
  - Настройка `disableNestedDelegation` (булевый тумблер в конфиге): при включении запрещает любое порождение субагентов дочерними сессиями с сообщением `NESTED_DELEGATION_GUARD_MESSAGE`.

#### 3. Адаптивная санитария инструментов и droppedTools (Issue #111)
- Автоматическая сверка запрашиваемых ролью инструментов со средой родителя/хоста.
- Формирование структурированного массива `droppedTools`:
  - `security`: опасные системные примитивы (`run_code` и др.);
  - `anti-redelegation`: инструменты рекурсивного делегирования;
  - `denied`: явно запрещённые конфигурацией плагина;
  - `unknown-or-unsupported`: отсутствующие в текущей среде инструменты.
- Результат `droppedTools` возвращается в ответе деливерабла и доступен для отображения в интерфейсе без падения задачи.

### 6. Execution Isolation, Lifecycle & Audit (Batch 2: Issues #93, #87, #56, #108)

#### 1. Per-Parent Serialization Gate & Concurrency Cap (`lib/pipeline/concurrency-gate.js`, Issue #93)
- **Per-Parent Promise Queue (`tail gate`)**:
  - Все параллельные запросы на запуск субагентов от одной родительской сессии сериализуются через сквозную цепочку промисов (`tailChains`).
  - Устраняет race conditions при залповом порождении воркеров (когда модель генерирует несколько вызовов инструментов в одном ответе).
- **Атомарная проверка емкости и квотирование**:
  - Атомарное бронирование слота в `activePerParent` с контролем лимита `maxConcurrentSubagents` (по умолчанию: 3).
  - Превышение лимита немедленно отклоняется понятной ошибкой до запуска дочернего контекста.

#### 2. Per-Call CWD Scoping & Workspace Sandboxing (`lib/pipeline/concurrency-gate.js`, Issue #87)
- **Изолированное окружение подпроекта**:
  - Поддержка адресного параметра `cwd` для монорепозиториев (например, `packages/core`, `services/auth`).
  - Проверка нахождения пути внутри базовой директории проекта (`path.resolve` containment check).
- **Fail-Closed запрет выхода из рабочей области**:
  - Попытки выхода через относительные переходы (`../../etc`) или внешние абсолютные пути немедленно пресекаются исключением `[WorkspaceScoping] Access denied`.
  - Сохранение нормализованного относительного пути при указании поддиректорий внутри проекта.

#### 3. Менеджер жизненного цикла сессий и очистка кэша (`lib/pipeline/session-lifecycle.js`, Issue #56)
- **Событийная архивация разовых субагентов**:
  - Автоматическая регистрация разовых легковесных субагентов (`one-shot`).
  - Запуск таймера авто-архивации с grace-периодом (по умолчанию 3 минуты) при получении события `subagent/end` или завершении выполнения воркера.
- **Синхронная очистка проекционного кэша (`session_projcache.json`)**:
  - При архивации сессия безопасно удаляется из `session_projcache.json`, предотвращая рост кэша до сотен мегабайт и блокировку event loop / CPU.
- **Фоновый аудит (Reconcile) и безопасная деактивация**:
  - Фоновый периодический аудит для очистки зависших или аварийно завершившихся сессий.
  - Полная очистка таймеров и контролируемая архивация при перезапуске или отключении плагина (`dispose()`).

#### 4. Decision Trace Ledger в `presentationMeta` (≤4KB) (`lib/pipeline/decision-trace.js`, Issue #108)
- **Многослойный реестр решений**:
  - Фиксация метаданных маршрутизации: назначенный специалист, причина выбора пресета/модели, статистика тулов (разрешено, вырезано защитой, запрещено), задержка выполнения и статус.
- **Изоляция от контекста LLM**:
  - Трейс проецируется исключительно в `presentationMeta` (UI метаданные), исключая засорение контекстного окна родительской модели при следующем шаге.
- **Аппаратный лимит размера (`MAX_TRACE_BYTES = 4096B`)**:
  - Каскадное усечение (`sanitizeDecisionTrace`) второстепенных полей при переполнении:
    1. Усечение длинных логов (до 64 символов).
    2. Полное удаление массива логов при необходимости.
    3. Усечение списка вырезанных инструментов `droppedTools`.
    4. Сокращение текстового обоснования `rationale`.
    5. Fallback до минимального дескриптора сущности `{ executionId, roleId, model, decision, truncated: true }`.

### 7. Resilient Routing, Deterministic Watchdog & Capacity Lifecycle (Batch 3: Issues #82, #48, #75, #67, #57)

#### 1. Fail-Fast Model Validation с Candidate Shortlist (`lib/pipeline/model-selection.js`, Issue #82)
- **Предварительная валидация модели (Pre-check)**:
  - Перед порождением контекста субагента выполняется сверка пары `provider/model` с живым реестром доступных провайдеров (`ctx.llm.listProviders()`).
- **Подсказка доступных альтернатив (Candidate Shortlist)**:
  - При опечатке или несовпадении модель не падает с непонятной ошибкой, а возвращает компактный список валидных моделей провайдера (`candidateShortlist: [...]`) и рекомендуемую модель.
  - Поддержка режима `failFast: true` с генерацией типизированной ошибки `ModelValidationError`.

#### 2. Smart Model Routing по типу и сложности задач (`lib/pipeline/model-selection.js`, Issue #48)
- **Классификация вычислительной сложности задач**:
  - `light` (документация, линтинг, форматирование, поиск файлов) $\rightarrow$ быстрые и экономичные модели (`deepseek-chat`, `flash`, `gpt-4o-mini`).
  - `reasoning` (архитектура, аудит безопасности, оптимизация алгоритмов, DBA) $\rightarrow$ тяжелые reasoning-модели (`deepseek-reasoner`, `deepseek-r1`, `o1`).
  - `balanced` $\rightarrow$ стандартная базовая модель сессии.
- **Управление и безопасность**:
  - Опция настраивается в конфиге плагина (`smartModelRouting: boolean`).
  - Белый список провайдеров (`allowedProviders: string[]`): защита от утечки данных и перерасхода бюджета.
  - **Graceful Fallback**: при отключении опции или недоступности провайдера происходит прозрачный откат на базовую модель сессии.

#### 3. Сторож автопродолжения при max-tokens с защитой от циклов (`lib/pipeline/token-watchdog.js`, Issue #75)
- **Перехват `max-tokens`**:
  - Автоматическое распознавание причин остановки `max-tokens`, `max_tokens` или `length`.
- **Точка восстановления (Flush Checkpoint)**:
  - Фиксация промежуточного состояния сессии перед вызовом продолжения.
- **Continue-Once Guarantee**:
  - Строго не более одного автоматического продолжения на цепочку выполнения (`continuationCount <= 1`).
  - Выходные фрагменты сквозным образом объединяются в единый деливерабл.
- **Защита от зацикливания (Cycle Protection)**:
  - При повторном исчерпании лимита генерация прерывается исключением `MaxTokensLoopError` с требованием декомпозиции задачи, предотвращая бесконечный расход токенов.

#### 4. Приоритетная каскадная ротация сессий по лимиту емкости (Capacity Recycling) (`lib/pipeline/session-lifecycle.js`, Issue #67)
- **Контроль предельной емкости**:
  - Лимит `maxStoredSessions` (по умолчанию: 400 сессий).
- **Иерархия вытеснения**:
  - Приоритет 1: отработавшие одноразовые субагенты (`one-shot`) методом oldest-first по `completedAt`.
  - Приоритет 2: долгоживущие субагенты (`continuable`), превысившие порог неактивности (`inactivityThresholdMs`, по умолчанию 1 час).
  - Приоритет 3: главные сессии (только при явном флаге `cleanMain: true`).
- **Pin Whitelist**:
  - Активные воркеры и закрепленные пользователем сессии (`isPinned: true`) безусловно защищены от ротации.

#### 5. Двухфазная обратимая очистка (Архивация в `sessions-archive/` с retention-удалением) (`lib/pipeline/session-lifecycle.js`, Issue #57)
- **Фаза 1 (Обратимый архив)**:
  - При завершении сессия перемещается в `~/.dsh/sessions-archive/<workspace>/<sessionId>/meta.json`, немедленно разгружая активный список UI и проекционный кэш.
- **Возможность восстановления (Restore)**:
  - Метод `restore(sessionId)` позволяет восстановить архивную сессию обратно в рабочий список до истечения срока хранения.
- **Фаза 2 (Физическое удаление)**:
  - Физическое удаление с диска выполняется строго по истечении retention-таймера (по умолчанию 24 часа).


### 8. Theme, Localization & Packaging Audit (Batch 4: Issues #114, #115, #116, #117, #120)

#### 1. DSW CSS Theme System Integration (`lib/client.js`, Issue #114)
- **Искоренение хардкод-палитры**: Заменены все 78 цветовых литералов (44 `rgba(...)` и 34 `#hex`) на канонические переменные дизайн-системы ядра:
  - Состояния: `var(--dsw-alias-state-success-*)`, `var(--dsw-alias-state-warning-*)`, `var(--dsw-alias-state-error-*)`, `var(--dsw-alias-state-info-*)`.
  - Поверхности и слои: `var(--dsw-alias-bg-layer-1)`, `var(--dsw-alias-bg-layer-2)`, `var(--dsw-alias-bg-layer-3)`, `var(--dsw-alias-bg-layer-4)`, `var(--dsw-alias-bg-mask)`.
  - Текст и метки: `var(--dsw-alias-label-primary)`, `var(--dsw-alias-label-secondary)`, `var(--dsw-alias-label-tertiary)`.
  - Границы: `var(--dsw-alias-border-base)`, `var(--dsw-alias-border-l1)`, `var(--dsw-alias-border-l2)`.
- Гарантирована 100% читаемость и контрастность на темной и светлой темах интерфейса DSH.
- Закреплен статический регрессионный тест `test/theme-locale-audit.test.mjs`, блокирующий появление `rgba` и `#hex` цветов.

#### 2. Безопасная регистрация локали в `ctx.effect` (`lib/client.js`, Issue #115)
- **Устранение утечек и подавления ошибок**: Вызов `ctx.locale.register` обернут в `ctx.effect(() => ctx.locale.register(NS, dicts), 'dsh-agent-orchestrator: locale')`.
- Сохранен возвращаемый уборщик (disposer), позволяющий Cordis корректно очищать словари при HMR или перезагрузке плагина.
- Убран пустой `catch (_) {}`. Повторный `apply()` безопасен и идемпотентен, что подтверждено тестом.

#### 3. Искоренение нелокализованных литералов и унификация бейджей (`lib/client.js`, `lib/index.js`, Issue #116)
- **Единый словарь бейджей**: Серверная (`lib/index.js`) и клиентская (`lib/client.js`) половины сведены к единому ключу `badge.accepted`.
- Все русские строки перенесены в словари (`ru` делегирован в `dsh-locale-ru` по стандарту экосистемы, `en` и `zh` встроены в плагин).
- `lib/client.js` и `lib/index.js` полностью очищены от кириллицы (0 вхождений).
- В `test/theme-locale-audit.test.mjs` добавлена строгая автоматическая проверка на отсутствие кириллицы в клиентской и хостовой поверхностях.

#### 4. Порог кеш-анкера `MIN_CACHE_ANCHOR_TOKENS = 1024` (`lib/pipeline/cache-prefixer.js`, Issue #117)
- **Обоснование порога**: Порог 1024 токена является аппаратным минимумом для инициализации KV-кэша в провайдерах (DeepSeek API, Anthropic Claude). При промпте короче 1024 токенов механизм кэширования префикса аппаратно отключается (Cache Miss), что приводит к росту стоимости каждого обращения на 90% и деградации задержек.
- **Гарантия превышения**: Базовый статический анкер расширен до 4306 символов (~1076 токенов), что гарантирует превышение `MIN_CACHE_ANCHOR_TOKENS` во всех сценариях.
- Добавлен автоматический тест в `test/cache-prefixer.test.mjs`, сверяющий длину анкера с константой.

#### 5. Изоляция runtime-зависимостей от DEV-окружения (`package.json`, Issue #120)
- Подтверждено соблюдение политики `AGENTS.md` («Worktree Не Бывает Runtime-Зависимостью»).
- В репозитории плагина отсутствуют отслеживаемые Git-файлы `.tgz` (включены в `.gitignore`).
- Подготовлен переход профиля `web` с локального tarball на опубликованную неизменяемую registry-версию без флагов `--force`.

### 9. Dynamic Model Catalog, Capability Routing, maxTokens, Reasoning Effort & Model Identity Chips (Batch 5: Issues #76, #74, #79, #86, #73)

#### 1. Динамический опрос каталога моделей (`model_subagent_catalog`) (`lib/pipeline/model-selection.js`, `lib/routes.js`, Issue #76)
- **Живой опрос провайдеров и моделей**:
  - `fetchModelCatalog(ctx)` динамически опрашивает зарегистрированные в Cordis адаптеры (`ctx.llm.listProviders()`) и их модели (`ctx.llm.listModels(providerId)`).
  - Модели нормализуются в структурированный каталог с семантическими возможностями, контекстными лимитами, флагами поддержки `reasoningEffort` и статусом авторизации согласно политике `subagent-model-selection`.
- **Инструмент и REST-маршруты**:
  - Зарегистрирован инструмент Cordis `model_subagent_catalog` с фильтрами по провайдеру (`provider`) и компетенциям (`capability`).
  - Добавлен REST-эндпоинт `GET /dsh-agent-orchestrator/catalog/models` и обогащен существующий `/dsh-agent-orchestrator/models`.

#### 2. Семантические теги возможностей моделей (`lib/pipeline/model-selection.js`, Issue #74)
- **Абстрагирование от названий моделей**:
  - Введены стандартизованные компетенции `MODEL_CAPABILITIES` (`coding`, `reasoning`, `fast`, `general`).
  - Функция `inferModelCapabilities(modelId, providerId)` классифицирует модели по ключевым сигнатурам (`reasoner/r1/o1/o3` -> `reasoning`, `coder/sonnet/gpt-4o` -> `coding`, `fast/mini/haiku/turbo` -> `fast`).
  - Функция `resolveModelByCapability(...)` выбирает подходящую модель из каталога с учетом политики `allowedRoutes`.

#### 3. Индивидуальный потолок выходных токенов на маршрут (`maxTokens per model route`) (`lib/pipeline/model-selection.js`, `lib/pipeline/delegation.js`, `lib/pipeline/worker-pool.js`, Issue #79)
- **Потолок токенов на алиас**:
  - Цепочка разрешения `resolveMaxTokens`: явный оверрайд запроса -> `role.maxTokens` -> лимит маршрута `route.maxTokens` -> дефолт по классу компетенции (2048 для `fast`, 8192 для `reasoning`, 4096 по умолчанию).
  - Сквозная передача `maxTokens` в `callLlm`, `subagents.start` и фиксация в `presentationMeta` и метриках.

#### 4. Управление глубиной рассуждений с безопасной валидацией (`lib/pipeline/model-selection.js`, Issue #86)
- **Уровни рассуждений (`ReasoningEffortId`)**:
  - Поддержка уровней `off`, `low`, `medium`, `high`, `max`.
  - Функция `isReasoningEffortSupported(...)` выполняет валидацию поддержки рассуждений.
  - На неподдерживающих моделях (например, `deepseek-chat`) выполняется мягкое отключение рассуждений с предупреждением без падения исполнения.

#### 5. Model Identity Chips в UI (`lib/client.js`, Issue #73)
- **Цветные бейджи и понятные алиасы**:
  - Компонент бейджей `.dso-model-chip` с дружественными названиями (`[Reasoner · R1]`, `[Fast Coder · V3]`, `[Coder · Sonnet 3.5]`, `[Fast · Mini]`, `[Local · Qwen]`).
  - Интеграция в карточки настроек агентов (`AgentProfilesTab`), карточку выполнения инструментов (`SpecialistToolview`) и шапку сессий субагентов (`HeaderOrchestratorWidget`).
  - Hover-тултип с подробной информацией (провайдер, модель, контекст, лимит токенов, поддержка рассуждений).
  - 100% следование дизайн-системе DSW: исключительно CSS-переменные `--dsw-alias-*`, нулевое использование `#hex` и `rgba()`.


### 10. Presets Self-Sync, Snapshots, Roster Viewer, Enabled Toggle & Allowlist Guard (Batch 6: Issues #109, #107, #105, #101, #104, #128)

#### 1. Защита белого списка инструментов от молчаливого сброса (Fail-Closed Allowlist Guard, Issue #104)
- **Класс ошибки FailClosedAllowlistError**:
  - В lib/pipeline/intersection.js реализована проверка: если роль требует ненулевой набор инструментов (
ormRole.length > 0), но пересечение с родительскими правами дает 0 разрешенных инструментов, генерируется FailClosedAllowlistError с кодом ERR_FAIL_CLOSED_ALLOWLIST.
  - Запрещает молчаливую передачу пустых прав субагентам, предотвращая несанкционированное падение или деградацию без инструментов.

#### 2. Снапшоты рабочих конфигураций и создание пресета в один клик (Dispatch Snapshots & One-Click Save as Preset, Issue #109)
- **Модуль SnapshotManager (lib/pipeline/snapshots.js)**:
  - Атомарная запись снапшотов через временные файлы .tmp с атомарным переименованием в ~/.dsh/orchestrator-snapshots/.
  - FIFO-политика хранения с жестким потолком в 200 снапшотов (автоматическая ротация старых записей).
  - Метод saveAsPreset(snapshotId, overrides) превращает завершенный запуск в переиспользуемый пресет сценария.
- **Интерфейсы и REST API**:
  - GET /dsh-agent-orchestrator/snapshots — список записанных снапшотов.
  - POST /dsh-agent-orchestrator/snapshots/save-as-preset — преобразование и сохранение снапшота в конфигурацию scenarios.
  - Кнопка 💾 Save as Preset в карточке результата специалиста (SpecialistToolview).

#### 3. Идемпотентная автосинхронизация пресетов при старте (Self-Syncing Presets, Issue #107)
- **Модуль syncDefaultPresets (lib/pipeline/preset-sync.js)**:
  - Автоматически вызывается в pply(ctx) при инициализации плагина.
  - Недеструктивное слияние: сохраняет все кастомные настройки ролей (модели, токены, промпты, статус enabled), добавляя только отсутствующие дефолтные роли и сценарии из scenarios.js.

#### 4. Быстрый просмотр реестра агентов через слэш-команду /subagents / /roster (Issue #105)
- **Команды чата /subagents и /roster**:
  - Зарегистрированы через сервис commands.
  - Формируют форматированную Markdown-таблицу активных и доступных ролей с их ID, моделями, лимитами токенов, статусом и инструментами/навыками.

#### 5. Управление активным составом агентов через переключатели (Enabled Roster / Toggle Filter, Issue #101)
- **Фильтрация в рантайме и UI**:
  - В lib/pipeline/guidance.js промпт-инструкция включает только роли с nabled !== false.
  - В карточке настроек AgentProfilesTab добавлены переключатели Active / Disabled для каждого агента и фильтр отображения All (N) / Active Only (M).

#### 6. Устранение дублирующей регистрации settings.section (Issue #128)
- **Очистка корня Settings**:
  - Из lib/client.js удалена безусловная регистрация слота settings.section, засорявшая левую панель настроек DSH.
  - Настройки плагина единообразно и изолированно регистрируются только через карточку settings.plugin.item.


#### 7. Очистка устаревших релизных архивов и политика сборки tarball (Issue #126)
- **Удаление устаревших tarball**:
  - Из корня репозитория удалены 6 устаревших релизных архивов (`0.1.0` – `0.1.5`).
  - Сохранен единственный актуальный архив `0.1.6`, используемый активным профилем `web` до момента официальной публикации пакета в npm registry.
- **Политика локальных сборок**:
  - Для предотвращения накопления артефактов в корне репозитория все будущие сборки перед публикацией направляются либо с перезаписью единого активного tarball, либо во внешний каталог артефактов.

## Locked Design Decisions
- **2026-09-14** — Каноническая 4-слойная структура контекста (Static Base -> Shared Task -> Cumulative Context -> Role Directive) для KV-кэша DeepSeek API.
- **2026-09-15** — Единый синонимичный мост DSH инструментов (read/edit/write/glob/grep/bash ⟷ view_file/replace_file_content/write_to_file/find_by_name/grep_search/run_command) и pure-reasoning fallback при наличии контекста задачи.
- **2026-09-18** — Введение Fail-closed HTTP Guard (loopback/origin verification + 1MB payload limit), Anti-Matryoshka Guard (`HARD_MAX_DEPTH = 3`, `disableNestedDelegation`), Leaf Expert Bound (`maxDepth: 1`) и разметки `droppedTools` (Issues #113, #103, #102, #19, #111).
- **2026-09-18** — Введение Per-Parent Serialization Gate & Concurrency Cap (#93), Per-Call CWD Scoping (#87), Session Lifecycle Manager с очисткой projcache (#56) и Decision Trace Ledger с лимитом payload ≤4KB в presentationMeta (#108).
- **2026-09-18** — Введение Fail-Fast Model Validation с Candidate Shortlist (#82), Smart Model Routing (#48), Deterministic max-tokens Watchdog с Continue-Once Guarantee (#75), Capacity Recycling по лимиту емкости (#67) и Two-Phase Reversible Archive в sessions-archive/ (#57).
- **2026-09-18** — Внедрение переменных CSS-темы DSW вместо 78 хардкод-цветов (#114), обертывание словарей в ctx.effect с сохранением disposer (#115), очистка кода от кириллицы с унификацией ключей (#116), валидация MIN_CACHE_ANCHOR_TOKENS = 1024 (#117) и аудит изоляции упаковки профилей (#120).
- **2026-09-18** — Внедрение динамического каталога моделей (model_subagent_catalog, #76), семантических тегов возможностей (#74), потолка maxTokens на маршрут (#79), управления глубиной рассуждений (reasoningEffort: off/low/medium/high/max, #86) и бейджей Model Identity Chips в UI (#73).
- **2026-09-18** — Введение Fail-Closed Allowlist Guard (#104), системы Dispatch Snapshots и One-Click Save as Preset (#109), идемпотентного Self-Sync пресетов (#107), слэш-команд /subagents и /roster (#105), управления активным составом агентов через enabled toggles (#101) и очистки корня Settings от дублирующей settings.section (#128), а также очистки устаревших релизных архивов .tgz (#126).


### 11. Security Hardening, Audit Fixes & Quality Engineering (Batch 7: Issues #135, #131, #132, #133, #134, #130)

#### 1. Защита от Path Traversal при работе со снимками (`lib/pipeline/snapshots.js`, `lib/routes.js`, Issue #135)
- **Строгая проверка идентификаторов снимков**:
  - В `SnapshotManager._pathFor(snapshotId)` введена валидация идентификаторов по белому списку символов `/^[a-zA-Z0-9_-]{1,64}$/`. Любые попытки передачи разделителей путей (`/`, `\`), последовательностей обхода (`..`), спецсимволов или нестроковых типов вызывают исключение.
  - Дополнительно через `path.resolve(this.baseDir, `${snapshotId}.json`)` гарантируется, что итоговый путь строго начинается с директории снимков (`path.resolve(this.baseDir) + path.sep`).
  - Проверка применена во всех точках входа: `getSnapshot`, `createSnapshot`, `saveAsPreset`.
  - Маршрут `POST /dsh-agent-orchestrator/snapshots/save-as-preset` отвечает HTTP `400 Bad Request` при передаче некорректного или traversal `snapshotId`.

#### 2. Очистка неиспользуемых экспортов (`lib/pipeline/model-selection.js`, Issue #131)
- Устранены неиспользуемые публичные экспорты `CAPABILITY_TAGS` и `MAX_TOKENS_BY_CAPABILITY`.
- Таблица лимитов токенов задействована непосредственно внутри функции `resolveMaxTokens` (`fast: 2048`, `general: 4096`, `coding: 8192`, `reasoning: 8192`), исключая мертвый код.

#### 3. Валидация сценариев на входе в runtime (`lib/pipeline/scenarios.js`, `lib/pipeline/preset-sync.js`, `lib/pipeline/decomposer.js`, `lib/routes.js`, Issue #132)
- Функция `validateScenario(scenario)` подключена ко всем точкам поступления и исполнения сценариев:
  - При самосинхронизации пресетов (`syncDefaultPresets`): невалидные пользовательские сценарии отсекаются с логированием предупреждения.
  - При декомпозиции задач (`decomposeTask`): перед созданием стадий проверяется связность DAG и отсутствие циклов.
  - При сохранении снимка как пресета (`saveAsPreset`) и обновлении конфигурации через REST (`POST /config`).

#### 4. Функциональные данные разбора ввода на естественном языке (`lib/pipeline/delegation.js`, `lib/pipeline/decomposer.js`, Issue #133)
- **Осознанное разграничение UI-строк и данных разбора ввода**:
  - Строки пользовательского интерфейса полностью вынесены в словари (`ru` делегирован в `dsh-locale-ru`, `en` и `zh` встроены в клиент).
  - Русские и английские алиасы ролей (`ROLE_INPUT_ALIASES` в `delegation.js`: `разработчик`, `программист`, `архитектор`, `тестировщик`, `ревьюер`, `документация`, `тз`, `дизайнер`, `бэкенд`, `фронтенд`, `девопс`) и регулярные выражения сложности задач (`COMPLEXITY_TRIGGERS` в `decomposer.js`: `новый плагин с нуля` -> `complex`, `быстро поправь опечатку` -> `simple`) являются **функциональными доменными данными парсера**.
  - Они необходимы для того, чтобы пользователь мог формулировать задачи и вызывать делегирование на естественном русском языке в чате DSH.
  - Данные вынесены в явные экспортируемые константы и покрыты исчерпывающим набором автоматических тестов `test/russian-input-parsing.test.mjs`.

#### 5. Согласованность объявлений внедрения клиентских сервисов (`package.json`, `lib/client.js`, Issue #134)
- Поле `package.json -> dsh.client.inject` заполнено фактически используемыми клиентом сервисами: `["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-slots"]`.
- Из `lib/client.js:module.exports.inject` удален неиспользуемый сервис `settingsScope`, оставлены только реальные зависимости `['slots', 'locale']`.
- Добавлен автоматический тест `test/client-inject.test.mjs`, контролирующий соответствие манифеста и кода.

#### 6. Полная миграция серверного логирования на `ctx.logger` (`lib/`, Issue #130)
- Все 33 вызова `console.*` в серверной половине плагина заменены на сервисный `logger` (`ctx.logger`) с соответствующими уровнями (`debug`, `warn`, `error`).
- Устранен паразитный отладочный вывод `console.log` при регистрации инструментов на старте.
- Инстансы `SnapshotManager`, `OrchestratorStore`, `SessionLifecycle` и функции конвейера принимают `logger` через параметры.
- Добавлен статический тест-страж `test/server-logger-guard.test.mjs`, проверяющий отсутствие `console.*` во всех файлах `lib/` (кроме браузерного `client.js`).
