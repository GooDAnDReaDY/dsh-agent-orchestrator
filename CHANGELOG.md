# Changelog

Notable changes to `@goodandready/dsh-agent-orchestrator`.

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
