# Changelog

Notable changes to `@goodandready/dsh-agent-orchestrator`.

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
