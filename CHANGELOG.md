# Changelog

Notable changes to `@goodandready/dsh-agent-orchestrator`.

## 0.1.10

### Fixed
- **DAG Execution Result Alignment**: Aligned `executeDAG` result properties with `stateMap` and `success` boolean in `lib/index.js` to ensure uniform pipeline status reporting (#146).
- **Prompt Cache Metrics Collection**: Connected `store.recordCompletion` call on DAG pipeline completion to aggregate cached and total prompt tokens, activating `overallHitRatio` computation (#147).
- **Slash Command Dispatch Guard**: Prevented duplicate pipeline dispatch on `/orchestrate` by distinguishing slash command invocations from natural language intents via `triggerKind` (#148).
- **Role Alias Matching Precision**: Added word-boundary checks for short specialist role aliases (`build`, `test-suite`) to prevent false-positive routing into `ui_design` (#149).
- **Client Polling Stabilization**: Eliminated rapid re-polling loops in `OrchestratorQuickBar` by stabilizing `useEffect` hook dependencies (#151).
- **Endpoint Security Hardening**: Guarded sensitive configuration and snapshot endpoints (`/config`, `/pipeline`, `/snapshots`) against untrusted cross-origin requests via `rejectUntrustedRequest` (#155).
- **HTTP Method Enforcement**: Enforced strict `405 Method Not Allowed` responses on read-only HTTP endpoints (#154).
- **DAG Cancellation Propagation**: Connected `AbortSignal` to cancel DAG execution and stop pending tasks without overwriting pipeline status (#156).
- **Engine Callback Resilience**: Guarded external progress/completion callbacks in `dag-engine` against unhandled exceptions, preserving `runningCount` and node status integrity (#157).

### Performance
- **Storage and Snapshot I/O Optimizations**: Added debounced writes (`saveDebounced`), compact JSON serialization, and in-memory TTL caching for snapshot listings to minimize filesystem I/O (#150).
- **KV-Cache Deterministic Prefix Ordering**: Ensured upstream task artifacts are deterministically sorted by task ID in Layer 3 worker pool contexts, preserving byte-exact KV-cache invariance (#152).

### Refactored
- **Dynamic Model Catalog Fallback**: Removed hardcoded vendor-specific model identifiers (`claude-3-5-sonnet`) from default model fallback pool, adhering to vendor-agnostic DSH catalog standards (#153).

## 0.1.9

### Changed
- **The root `settings.section` registration is gone.** The owner does not want our
  plugins in the root Settings list; the settings live on the plugin's own page via
  the plugin-list seat (`plugins.item`) and the Settings → Plugins tab, both of which
  stay.
- **The `label` closures are static strings again.** They read `ctx.t` behind a
  `typeof` guard, and the core's inject proxy throws on the property access itself —
  the guard never ran, and the label raised
  `cannot get property "t" without inject` while the slot snapshot was built. That
  exception aborts the whole client batch, which is what emptied the Settings
  sections and every plugin settings card. The `plugins.item` and
  `settings.plugins.tab` labels now return `'Agent Orchestrator'` directly.
- The Issue #139 test no longer demands `settings.section`; it now asserts that the
  seat is **not** registered.

## 0.1.8

### Fixed
- **The plugin no longer breaks the whole client layer.** The `label` closures of the
  `settings.plugins.tab`, `plugins.item` and `settings.section` entries read `ctx.t`
  behind a `typeof ctx.t === 'function'` guard — but the core's inject proxy throws on
  the property access itself, so the label raised
  `cannot get property "t" without inject` while the slot snapshot was built. That
  exception aborted the client batch, which is why the Settings sections and every
  plugin settings card disappeared from the UI. All three labels now resolve inside a
  `try`/`catch` and fall back to the static title.

## 0.1.7

### Fixed
- **Settings reachable on the plugin's own page (#139).** The client registered the
  settings surface into `plugins.item`, `settings.plugins.tab` and
  `settings.section`, but never into the seat the current DSH core
  (0.1.6-alpha.2) renders for a plugin's own configuration: `plugins.row.config`,
  keyed `<package name>#<row id>`. The card is now registered there first, keyed
  `@goodandready/dsh-agent-orchestrator#dsh-agent-orchestrator`, and renders both
  views the host asks for: `view: 'summary'` (one-line description) and
  `view: 'page'` (the settings form, expanded and without our card chrome — the host
  page draws the title, icon, crumb and padding). Existing seats stay registered as
  fallbacks, so settings remain reachable on older cores.

### Added
- This changelog. Version history and issue references live here and in release
  notes, not in the README.
