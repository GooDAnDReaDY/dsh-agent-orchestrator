/**
 * DeepSeek Harness Multi-Agent Orchestrator Browser Client
 *
 * Scoped ID: @goodandready/dsh-agent-orchestrator
 * Namespace: dsh-agent-orchestrator
 */

window.__ModuleLoader__.load({
  id: '@goodandready/dsh-agent-orchestrator',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const { useState, useEffect, useCallback } = React
    const h = React.createElement

    const NS = 'dsh-agent-orchestrator'

    // ErrorBoundary to guard against any component rendering exceptions
    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { hasError: false, error: null }
      }
      static getDerivedStateFromError(error) {
        return { hasError: true, error }
      }
      componentDidCatch(error, errorInfo) {
        console.error('[dsh-agent-orchestrator] UI render error:', error, errorInfo)
      }
      render() {
        if (this.state.hasError) {
          return h('div', { style: { padding: '12px 16px', color: 'var(--dsw-alias-state-error-primary)', fontSize: 13 } },
            h('strong', null, 'Orchestrator UI Error: '),
            String(this.state.error?.message || this.state.error),
            h('button', {
              type: 'button',
              style: { marginLeft: 12, padding: '2px 8px', fontSize: 11, cursor: 'pointer' },
              onClick: () => this.setState({ hasError: false, error: null }),
            }, 'Retry')
          )
        }
        return this.props?.children || null
      }
    }

    // System Chevron icon helper
    let ChevronIcon = null
    try {
      const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
      ChevronIcon = primitives && primitives.IconChevronDownOutline14
    } catch {
      ChevronIcon = null
    }

    const FallbackChevron = () =>
      h('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 14 14',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
      }, h('path', { d: 'M3.5 5.25L7 8.75L10.5 5.25', strokeLinecap: 'round', strokeLinejoin: 'round' }))

    const Chevron = ChevronIcon || FallbackChevron

    // CSS Theme Styles Injection
    const CSS = `

.dso-filter-btn { appearance: none; font: inherit; background: transparent; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 2px 8px; font-size: 11px; color: var(--dsw-alias-label-secondary); cursor: pointer; transition: all 0.12s ease; }
.dso-filter-btn:hover { background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); }
.dso-filter-btn.active { background: var(--dsw-alias-bg-layer-3); border-color: var(--dsw-alias-state-info-border); color: var(--dsw-alias-state-info-primary); font-weight: 600; }
.dso-toggle-label { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dso-toggle-checkbox { width: 14px; height: 14px; cursor: pointer; }
.dso-preset-btn { appearance: none; font: inherit; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 3px 8px; font-size: 11px; font-weight: 500; color: var(--dsw-alias-label-primary); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: all 0.12s ease; }
.dso-preset-btn:hover { background: var(--dsw-alias-bg-layer-4); border-color: var(--dsw-alias-state-info-border); }

.dso-card { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3); border-radius: 12px; list-style: none; margin-bottom: 12px; }
.dso-head { appearance: none; width: 100%; font: inherit; color: inherit; text-align: left; cursor: pointer; background: 0 0; border: 0; border-radius: 12px; display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
.dso-head-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.dso-title { color: var(--dsw-alias-label-primary); font-size: 15px; font-weight: 600; line-height: 1.4; display: flex; align-items: center; gap: 8px; }
.dso-badge { font-size: 11px; font-weight: 500; padding: 2px 7px; border-radius: 6px; background: var(--dsw-alias-state-info-bg); color: var(--dsw-alias-state-info-primary); border: 1px solid var(--dsw-alias-state-info-border); }
.dso-sub { color: var(--dsw-alias-label-secondary); font-size: 13px; }
.dso-chev { margin-left: auto; flex: none; color: var(--dsw-alias-label-tertiary); transition: transform 0.16s ease; }
.dso-chev-open { transform: rotate(180deg); }
.dso-body { border-top: 1px solid var(--dsw-alias-border-l2); margin: 0 16px; padding: 12px 0 16px; }

.dso-tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--dsw-alias-border-l2); padding-bottom: 10px; margin-bottom: 14px; overflow-x: auto; }
.dso-tab { appearance: none; background: transparent; border: 1px solid transparent; border-radius: 7px; padding: 5px 12px; font-size: 13px; color: var(--dsw-alias-label-secondary); cursor: pointer; font-weight: 500; transition: all 0.15s; }
.dso-tab:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.dso-tab-active { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l2); }

.dso-panel { display: flex; flex-direction: column; gap: 14px; }
.dso-agent-list { display: flex; flex-direction: column; gap: 10px; max-height: 480px; overflow-y: auto; padding-right: 4px; }
.dso-agent-row { border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; padding: 12px; background: var(--dsw-alias-bg-layer-2); display: flex; flex-direction: column; gap: 8px; }
.dso-agent-header { display: flex; align-items: center; justify-content: space-between; }
.dso-agent-name { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dso-agent-role { font-size: 12px; color: var(--dsw-alias-label-secondary); }

.dso-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.dso-field { display: flex; flex-direction: column; gap: 4px; }
.dso-label { font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.dso-input, .dso-select { height: 32px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); border-radius: 7px; padding: 0 10px; font-size: 13px; outline: none; }
.dso-textarea { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); border-radius: 7px; padding: 8px 10px; font-size: 12px; font-family: monospace; outline: none; resize: vertical; min-height: 70px; }

.dso-stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; }
.dso-stat-box { border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; padding: 12px; text-align: center; background: var(--dsw-alias-bg-layer-2); }
.dso-stat-val { font-size: 20px; font-weight: 700; color: var(--dsw-alias-state-success-primary); }
.dso-stat-lbl { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 4px; }

.dso-foot { border-top: 1px solid var(--dsw-alias-border-l2); display: flex; justify-content: flex-end; align-items: center; gap: 8px; padding-top: 12px; margin-top: 10px; }
.dso-btn { appearance: none; font: inherit; cursor: pointer; border: 1px solid transparent; border-radius: 8px; padding: 6px 14px; font-size: 13px; font-weight: 500; }
.dso-btn-primary { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); }
.dso-btn-subtle { background: transparent; border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }

.dso-widget { display: inline-flex; align-items: center; gap: 8px; padding: 4px 10px; border-radius: 8px; background: var(--dsw-alias-state-info-bg); border: 1px solid var(--dsw-alias-state-info-border); font-size: 12px; color: var(--dsw-alias-label-primary); }
.dso-widget-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); box-shadow: 0 0 6px var(--dsw-alias-state-success-primary); }
.dso-widget-badge { font-weight: 600; color: var(--dsw-alias-state-info-primary); }

.dso-dock { box-sizing: border-box; width: calc(100% - var(--dsh-composer-side-clearance, 0px) * 2 - var(--dsh-composer-dock-inset, 0px) * 4); max-width: calc(var(--dsh-composer-card-max-width, 768px) - var(--dsh-composer-dock-inset, 0px) * 4); margin: 0 auto 8px auto; display: flex; justify-content: center; }
.dso-dock.dso-dock-quick { justify-content: flex-start; margin-bottom: 4px; }
.dso-banner { box-sizing: border-box; width: 100%; display: flex; align-items: center; justify-content: space-between; background: var(--dsw-alias-bg-layer-3); border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; padding: 7px 14px; font-family: inherit; font-size: 13px; color: var(--dsw-alias-label-primary); user-select: none; box-shadow: none; transition: all 0.15s ease; gap: 8px; }
.dso-banner:hover { border-color: var(--dsw-alias-label-tertiary); }
.dso-banner.completed { border-color: var(--dsw-alias-state-success-primary); }
.dso-banner.failed { border-color: var(--dsw-alias-state-error-primary); }
.dso-banner-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
.dso-banner-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); display: inline-flex; align-items: center; gap: 4px; font-weight: 600; white-space: nowrap; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dso-banner-badge.dso-badge-running { border-color: var(--dsw-alias-state-info-border); color: var(--dsw-alias-state-info-primary); background: var(--dsw-alias-state-info-bg); }
.dso-banner-badge.dso-badge-ok { border-color: var(--dsw-alias-state-success-border); color: var(--dsw-alias-state-success-primary); background: var(--dsw-alias-state-success-bg); }
.dso-banner-badge.dso-badge-err { border-color: var(--dsw-alias-state-error-border); color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-state-error-bg); }
.dso-banner-title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
.dso-banner-stage { font-size: 12px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); padding: 2px 6px; border-radius: 5px; white-space: nowrap; }
.dso-banner-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.dso-banner-time { font-size: 12px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dso-dock-btn { appearance: none; font: inherit; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 3px 8px; font-size: 12px; color: var(--dsw-alias-label-primary); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: all 0.12s; }
.dso-dock-btn:hover { background: var(--dsw-alias-bg-layer-4); border-color: var(--dsw-alias-label-tertiary); }
.dso-dock-btn.close { padding: 3px 6px; color: var(--dsw-alias-label-secondary); }
.dso-dock-btn.close:hover { color: var(--dsw-alias-state-error-primary); }
.dso-quicklaunch-btn { appearance: none; font: inherit; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; padding: 4px 12px; font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all 0.12s ease; }
.dso-quicklaunch-btn:hover { background: var(--dsw-alias-bg-layer-3); border-color: var(--dsw-alias-label-tertiary); color: var(--dsw-alias-label-primary); }
.dso-pulse-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-info-primary); animation: dso-pulse 1.6s infinite ease-in-out; }
@keyframes dso-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.8); } }
.dso-modal-backdrop { position: fixed; inset: 0; background: var(--dsw-alias-bg-mask, var(--dsw-alias-bg-layer-4)); z-index: 99999; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(2px); }
.dso-modal { background: var(--dsw-alias-bg-layer-3); border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; width: 92%; max-width: 580px; max-height: 85vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: var(--dsw-alias-shadow-modal, 0 8px 24px var(--dsw-alias-border-l2)); font-family: inherit; color: var(--dsw-alias-label-primary); }
.dso-modal-head { padding: 14px 18px; border-bottom: 1px solid var(--dsw-alias-border-l2); display: flex; align-items: center; justify-content: space-between; font-weight: 600; font-size: 15px; }
.dso-modal-body { padding: 16px 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.dso-modal-foot { padding: 12px 18px; border-top: 1px solid var(--dsw-alias-border-l2); display: flex; justify-content: flex-end; gap: 8px; }
.dso-stage-item { border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 10px 12px; background: var(--dsw-alias-bg-layer-2); display: flex; flex-direction: column; gap: 6px; }
.dso-stage-head { display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-weight: 500; }
.dso-stage-log { font-family: monospace; font-size: 11px; background: var(--dsw-alias-bg-layer-1); padding: 8px; border-radius: 6px; max-height: 120px; overflow-y: auto; white-space: pre-wrap; color: var(--dsw-alias-label-secondary); }
/* Issue #3: Subagent Header Utilities Chip */
.dso-subagent-header-chip { display: inline-flex; align-items: center; gap: 6px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dso-chip-icon { font-size: 13px; }
.dso-chip-role { font-weight: 600; color: var(--dsw-alias-state-info-primary); }
.dso-chip-sep { color: var(--dsw-alias-label-tertiary); }
.dso-chip-model { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dso-chip-parent-link { color: var(--dsw-alias-link); text-decoration: none; font-size: 11px; padding: 1px 6px; background: var(--dsw-alias-state-info-bg); border-radius: 4px; transition: all 0.15s ease; cursor: pointer; }
.dso-chip-parent-link:hover { background: var(--dsw-alias-bg-layer-3); text-decoration: underline; }

/* Issue #5: Specialist Toolview Card */
.dso-toolview-card { background: var(--dsw-alias-bg-layer-3); border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; padding: 12px 14px; margin: 6px 0; display: flex; flex-direction: column; gap: 10px; font-family: inherit; font-size: 13px; color: var(--dsw-alias-label-primary); }
.dso-toolview-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dso-toolview-badge { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 13px; }
.dso-toolview-model-tag { font-size: 11px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); padding: 2px 7px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); }
.dso-model-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 500; padding: 2px 7px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); cursor: help; white-space: nowrap; user-select: none; }
.dso-model-chip.reasoner { border-color: var(--dsw-alias-state-warning-border, var(--dsw-alias-border-l2)); color: var(--dsw-alias-state-warning-text, var(--dsw-alias-label-primary)); background: var(--dsw-alias-state-warning-bg); }
.dso-model-chip.coder { border-color: var(--dsw-alias-state-info-border, var(--dsw-alias-border-l2)); color: var(--dsw-alias-state-info-text, var(--dsw-alias-label-primary)); background: var(--dsw-alias-state-info-bg); }
.dso-model-chip.fast { border-color: var(--dsw-alias-state-success-border, var(--dsw-alias-border-l2)); color: var(--dsw-alias-state-success-text, var(--dsw-alias-label-primary)); background: var(--dsw-alias-state-success-bg); }
.dso-model-chip.local { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-1); }
.dso-toolview-status-pill { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.dso-toolview-status-pill.ok { background: var(--dsw-alias-state-success-bg); color: var(--dsw-alias-state-success-primary); border: 1px solid var(--dsw-alias-state-success-border); }
.dso-toolview-status-pill.running { background: var(--dsw-alias-state-info-bg); color: var(--dsw-alias-state-info-primary); border: 1px solid var(--dsw-alias-state-info-border); }
.dso-toolview-status-pill.err { background: var(--dsw-alias-state-error-bg); color: var(--dsw-alias-state-error-primary); border: 1px solid var(--dsw-alias-state-error-border); }
.dso-toolview-tooldiff { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.dso-tooldiff-summary { cursor: pointer; font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary); display: flex; align-items: center; gap: 6px; user-select: none; }
.dso-tooldiff-pills { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.dso-pill { padding: 1px 6px; border-radius: 4px; font-size: 11px; font-family: monospace; }
.dso-pill.allow { background: var(--dsw-alias-state-success-bg); color: var(--dsw-alias-state-success-primary); border: 1px solid var(--dsw-alias-state-success-border); }
.dso-pill.blocked { background: var(--dsw-alias-state-error-bg); color: var(--dsw-alias-state-error-primary); text-decoration: line-through; border: 1px solid var(--dsw-alias-state-error-border); }
.dso-pill.denied { background: var(--dsw-alias-state-warning-bg); color: var(--dsw-alias-state-warning-primary); border: 1px solid var(--dsw-alias-state-warning-border); }
.dso-toolview-deliverable { background: var(--dsw-alias-bg-layer-2); border-radius: 6px; padding: 10px 12px; font-size: 13px; line-height: 1.5; max-height: 280px; overflow-y: auto; white-space: pre-wrap; color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l1); }
.dso-toolview-callout { padding: 6px 10px; border-radius: 6px; font-size: 12px; font-weight: 500; background: var(--dsw-alias-state-success-bg); border: 1px solid var(--dsw-alias-state-success-border); color: var(--dsw-alias-state-success-primary); display: flex; align-items: center; gap: 6px; }

`

    function formatModelChip(modelStr, options = {}) {
      const m = String(modelStr || '').toLowerCase()
      let label = 'General'
      let alias = modelStr || 'default'
      let badgeClass = 'general'

      if (/reasoner|r1/i.test(m)) {
        alias = 'R1'
        label = 'Reasoner'
        badgeClass = 'reasoner'
      } else if (/o1/i.test(m)) {
        alias = 'o1'
        label = 'Reasoner'
        badgeClass = 'reasoner'
      } else if (/o3/i.test(m)) {
        alias = 'o3'
        label = 'Reasoner'
        badgeClass = 'reasoner'
      } else if (/deepseek-chat|v3/i.test(m)) {
        alias = 'V3'
        label = 'Fast Coder'
        badgeClass = 'coder'
      } else if (/coder/i.test(m)) {
        alias = 'Coder'
        label = 'Coder'
        badgeClass = 'coder'
      } else if (/sonnet/i.test(m)) {
        alias = 'Sonnet 3.5'
        label = 'Coder'
        badgeClass = 'coder'
      } else if (/flash|mini|haiku/i.test(m)) {
        alias = m.includes('mini') ? 'Mini' : (m.includes('haiku') ? 'Haiku' : 'Flash')
        label = 'Fast'
        badgeClass = 'fast'
      } else if (/qwen/i.test(m)) {
        alias = 'Qwen'
        label = 'Local'
        badgeClass = 'local'
      }

      const maxTokens = options.maxTokens || (/reasoner|r1|o1|o3/i.test(m) ? 8192 : (/mini|flash|fast/i.test(m) ? 2048 : 4096))
      const reasoningText = /reasoner|r1|o1|o3/i.test(m) ? 'Supported' : 'No'
      const tooltip = `${modelStr || 'default'} (Context: 64k, Output: ${maxTokens}, Reasoning: ${reasoningText})`

      return {
        text: `[${label} · ${alias}]`,
        label,
        alias,
        badgeClass,
        tooltip,
      }
    }

    function ensureStyles() {
      if (document.querySelector('style[data-dsh-plugin="dsh-agent-orchestrator"]')) return
      const style = document.createElement('style')
      style.dataset.dshPlugin = 'dsh-agent-orchestrator'
      style.textContent = CSS
      document.head.appendChild(style)
    }

    // --- Tab 1: Agent Profiles (Issue #101 Enabled Roster / Toggle Filter) ---
    function AgentProfilesTab({ roles = {}, onRoleChange, onAddRole }) {
      const [filterMode, setFilterMode] = useState('all')
      const allRoles = Object.values(roles)
      const roleList = filterMode === 'active' ? allRoles.filter((r) => r.enabled !== false) : allRoles

      return h('div', { className: 'dso-panel' },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 } },
          h('span', { className: 'dso-sub' }, 'Self-contained agent profiles stored purely in plugin settings (no external files).'),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('div', { style: { display: 'inline-flex', gap: 4 } },
              h('button', {
                type: 'button',
                className: `dso-filter-btn ${filterMode === 'all' ? 'active' : ''}`,
                onClick: () => setFilterMode('all'),
              }, `All (${allRoles.length})`),
              h('button', {
                type: 'button',
                className: `dso-filter-btn ${filterMode === 'active' ? 'active' : ''}`,
                onClick: () => setFilterMode('active'),
              }, `Active Only (${allRoles.filter((r) => r.enabled !== false).length})`)
            ),
            h('button', {
              className: 'dso-btn dso-btn-subtle',
              type: 'button',
              onClick: onAddRole,
            }, '+ Add Custom Agent')
          )
        ),
        h('div', { className: 'dso-agent-list' },
          roleList.map((role) => {
            const isEnabled = role.enabled !== false
            const modelChip = formatModelChip(role.defaultModel?.model, { maxTokens: role.maxTokens })
            return h('div', { key: role.id, className: 'dso-agent-row', style: { opacity: isEnabled ? 1 : 0.65 } },
              h('div', { className: 'dso-agent-header' },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  h('label', { className: 'dso-toggle-label', title: isEnabled ? 'Agent is Active' : 'Agent is Disabled' },
                    h('input', {
                      type: 'checkbox',
                      className: 'dso-toggle-checkbox',
                      checked: isEnabled,
                      onChange: (e) => onRoleChange(role.id, { enabled: e.target.checked }),
                    }),
                    h('span', { style: { fontWeight: 500, color: isEnabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-tertiary)' } },
                      isEnabled ? 'Active' : 'Disabled'
                    )
                  ),
                  h('span', { className: 'dso-agent-name' }, role.name),
                  h('span', { className: 'dso-agent-role' }, `(${role.category || role.id})`),
                  h('span', { className: `dso-model-chip ${modelChip.badgeClass}`, title: modelChip.tooltip }, modelChip.text)
                ),
                h('span', { className: 'dso-badge' }, `Reasoning: ${role.reasoningEffort || 'medium'}`)
              ),
              h('div', { className: 'dso-grid-2' },
                h('div', { className: 'dso-field' },
                  h('label', { className: 'dso-label' }, 'Model Provider & Name'),
                  h('input', {
                    className: 'dso-input',
                    value: role.defaultModel?.model || '',
                    onChange: (e) => onRoleChange(role.id, {
                      defaultModel: { ...(role.defaultModel || { provider: 'deepseek' }), model: e.target.value },
                    }),
                    placeholder: 'e.g. deepseek-chat or claude-3-5-sonnet',
                  })
                ),
                h('div', { className: 'dso-field' },
                  h('label', { className: 'dso-label' }, 'Max Output Tokens (0 = Default)'),
                  h('input', {
                    className: 'dso-input',
                    type: 'number',
                    value: role.maxTokens || '',
                    onChange: (e) => onRoleChange(role.id, {
                      maxTokens: e.target.value ? parseInt(e.target.value, 10) : undefined,
                    }),
                    placeholder: 'e.g. 2048, 4096, 8192',
                  })
                )
              ),
              h('div', { className: 'dso-field' },
                h('label', { className: 'dso-label' }, 'Reasoning Effort (Supported on Reasoning Models)'),
                h('select', {
                  className: 'dso-select',
                  value: role.reasoningEffort || 'medium',
                  onChange: (e) => onRoleChange(role.id, { reasoningEffort: e.target.value }),
                },
                  h('option', { value: 'disabled' }, 'Disabled (None)'),
                  h('option', { value: 'off' }, 'Off'),
                  h('option', { value: 'low' }, 'Low (Fast)'),
                  h('option', { value: 'medium' }, 'Medium (Standard)'),
                  h('option', { value: 'high' }, 'High (Deep Thinking)'),
                  h('option', { value: 'max' }, 'Max (Exhaustive Reasoning)')
                )
              ),
              h('div', { className: 'dso-field' },
                h('label', { className: 'dso-label' }, 'SOUL / Specialized Role Instructions'),
                h('textarea', {
                  className: 'dso-textarea',
                  value: role.systemPrompt || '',
                  onChange: (e) => onRoleChange(role.id, { systemPrompt: e.target.value }),
                  placeholder: 'Describe role responsibilities, deliverables, and strict boundaries...',
                })
              ),
              h('div', { className: 'dso-field' },
                h('label', { className: 'dso-label' }, 'Skills (comma-separated)'),
                h('input', {
                  className: 'dso-input',
                  value: Array.isArray(role.skills) ? role.skills.join(', ') : '',
                  onChange: (e) => onRoleChange(role.id, {
                    skills: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                  }),
                  placeholder: 'e.g. project-design-contract, dsh-ui-design',
                })
              )
            )
          })
        )
      )
    }

    // --- Tab 2: Workflow Scenarios ---
    function ScenariosTab({ scenarios = {}, roles = {} }) {
      const scenarioList = Object.values(scenarios)

      return h('div', { className: 'dso-panel' },
        h('span', { className: 'dso-sub' }, 'Interactive DAG topologies: stages, blockers, and concurrency permissions.'),
        scenarioList.map((sc) =>
          h('div', { key: sc.id, className: 'dso-agent-row' },
            h('div', { className: 'dso-agent-header' },
              h('div', null,
                h('strong', { style: { color: 'var(--dsw-alias-label-primary)' } }, sc.title),
                h('div', { className: 'dso-sub' }, sc.description)
              ),
              h('span', { className: 'dso-badge' }, `${sc.stages?.length || 0} Stages`)
            ),
            h('div', { style: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 } },
              (sc.stages || []).map((st, idx) =>
                h('div', {
                  key: st.id,
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    background: 'var(--dsw-alias-bg-layer-2)',
                    borderRadius: 6,
                    fontSize: 12,
                  },
                },
                  h('span', { style: { fontWeight: 600, width: 20 } }, `${idx + 1}.`),
                  h('span', { style: { flex: 1, color: 'var(--dsw-alias-label-primary)' } }, st.name),
                  h('span', { className: 'dso-badge', style: { fontSize: 10 } }, `Role: ${roles[st.roleId]?.name || st.roleId}`),
                  st.dependsOn?.length > 0
                    ? h('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 } }, `Blocks on: ${st.dependsOn.join(', ')}`)
                    : h('span', { style: { color: 'var(--dsw-alias-state-success-primary)', fontSize: 11 } }, 'Starts immediately')
                )
              )
            )
          )
        )
      )
    }

    // --- Tab 3: Prompt Caching Telemetry ---
    function CacheMetricsTab({ metrics = {} }) {
      const hitRatioPct = Math.round((metrics.overallHitRatio || 0) * 100)

      return h('div', { className: 'dso-panel' },
        h('div', { className: 'dso-stats-grid' },
          h('div', { className: 'dso-stat-box' },
            h('div', { className: 'dso-stat-val' }, `${hitRatioPct}%`),
            h('div', { className: 'dso-stat-lbl' }, 'Overall Cache Hit Rate')
          ),
          h('div', { className: 'dso-stat-box' },
            h('div', { className: 'dso-stat-val', style: { color: 'var(--dsw-alias-state-info-primary)' } }, (metrics.totalCacheHitTokens || 0).toLocaleString()),
            h('div', { className: 'dso-stat-lbl' }, 'Cached Input Tokens Reused')
          ),
          h('div', { className: 'dso-stat-box' },
            h('div', { className: 'dso-stat-val', style: { color: 'var(--dsw-alias-state-warning-primary)' } }, String(metrics.completedPipelines || 0)),
            h('div', { className: 'dso-stat-lbl' }, 'Completed Pipelines')
          )
        ),
        h('div', { style: { padding: 12, background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 8, fontSize: 13, lineHeight: 1.6 } },
          h('strong', { style: { color: 'var(--dsw-alias-label-primary)' } }, 'Prompt Caching Mechanics:'),
          h('p', { style: { margin: '6px 0 0', color: 'var(--dsw-alias-label-secondary)' } },
            'All agents sharing the same model receive an identical canonical base anchor (>1024 tokens) and shared task context. Subsequent stages sequentially append prior artifacts, yielding near-instantaneous Time to First Token (TTFT) and an estimated 80–90% cost savings on DeepSeek and Claude models.'
          )
        )
      )
    }

    // --- Tab 4: Kanban Integration ---
    function KanbanTab({ config = {}, onConfigChange }) {
      const kanbanSync = config.kanbanSync || {
        enabled: false,
        targetColumn: 'review',
        createChecklist: true,
      }

      const updateSync = (patch) => {
        onConfigChange({
          kanbanSync: { ...kanbanSync, ...patch },
        })
      }

      return h('div', { className: 'dso-panel' },
        h('span', { className: 'dso-sub' },
          'Bidirectional synchronization with @goodandready/dsh-kanban: update task checklists and advance cards upon pipeline completion.'
        ),
        h('div', { className: 'dso-agent-row' },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            h('div', null,
              h('strong', { style: { color: 'var(--dsw-alias-label-primary)' } }, 'Enable Kanban Synchronization'),
              h('div', { className: 'dso-sub' }, 'Automatically link orchestrated DAG pipelines to Kanban task cards.')
            ),
            h('input', {
              type: 'checkbox',
              style: { width: 18, height: 18, cursor: 'pointer' },
              checked: !!kanbanSync.enabled,
              onChange: (e) => updateSync({ enabled: e.target.checked }),
            })
          ),
          h('div', { className: 'dso-grid-2', style: { marginTop: 10 } },
            h('div', { className: 'dso-field' },
              h('label', { className: 'dso-label' }, 'Target Column on Completion'),
              h('input', {
                className: 'dso-input',
                value: kanbanSync.targetColumn || 'review',
                onChange: (e) => updateSync({ targetColumn: e.target.value }),
                placeholder: 'e.g. review, deploy, in-progress',
              }),
              h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', marginTop: 3 } },
                'Default: "review". Automated agents finish work in Review; moving to "done" is reserved for human acceptance.'
              )
            ),
            h('div', { className: 'dso-field' },
              h('label', { className: 'dso-label' }, 'Auto-create Checklist Items'),
              h('select', {
                className: 'dso-select',
                value: kanbanSync.createChecklist !== false ? 'true' : 'false',
                onChange: (e) => updateSync({ createChecklist: e.target.value === 'true' }),
              },
                h('option', { value: 'true' }, 'Enabled (Add DAG stages to card checklist)'),
                h('option', { value: 'false' }, 'Disabled (Only move columns)')
              )
            )
          ),
          h('div', { style: { marginTop: 8, padding: '8px 12px', background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 7, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
            'Connected to Kanban Service on port 3080/3082. Changes are applied upon clicking "Save Changes" below.'
          )
        )
      )
    }

    // --- Main Settings Card ---
    function OrchestratorSettingsCard() {
      const [isOpen, setIsOpen] = useState(false)
      const [activeTab, setActiveTab] = useState('roles')
      const [config, setConfig] = useState(null)
      const [metrics, setMetrics] = useState({})
      const [saving, setSaving] = useState(false)
      const [statusMsg, setStatusMsg] = useState('')

      useEffect(() => {
        ensureStyles()
        fetch('/dsh-agent-orchestrator/config')
          .then((r) => r.json())
          .then((d) => setConfig(d.config))
          .catch(() => {})

        fetch('/dsh-agent-orchestrator/status')
          .then((r) => r.json())
          .then((d) => setMetrics(d.metrics || {}))
          .catch(() => {})
      }, [])

      const handleRoleChange = useCallback((roleId, patch) => {
        setConfig((prev) => {
          if (!prev) return prev
          const updatedRoles = {
            ...prev.roles,
            [roleId]: { ...prev.roles[roleId], ...patch },
          }
          return { ...prev, roles: updatedRoles }
        })
      }, [])

      const handleAddRole = useCallback(() => {
        const newId = `custom_role_${Date.now().toString(36)}`
        setConfig((prev) => {
          if (!prev) return prev
          const updatedRoles = {
            ...prev.roles,
            [newId]: {
              id: newId,
              name: 'New Custom Specialist',
              category: 'Custom Specialty',
              defaultModel: { provider: 'deepseek', model: 'deepseek-chat' },
              reasoningEffort: 'medium',
              skills: [],
              tools: ['view_file'],
              systemPrompt: 'You are a specialized agent. Fulfill designated stage deliverables.',
              temperature: 0.2,
              maxTokens: 4096,
            },
          }
          return { ...prev, roles: updatedRoles }
        })
      }, [])

      const handleSave = async () => {
        setSaving(true)
        setStatusMsg('')
        try {
          const res = await fetch('/dsh-agent-orchestrator/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config),
          })
          if (res.ok) {
            setStatusMsg('Settings saved successfully')
            setTimeout(() => setStatusMsg(''), 3000)
          } else {
            setStatusMsg('Error saving settings')
          }
        } catch {
          setStatusMsg('Network error')
        } finally {
          setSaving(false)
        }
      }

      return h('li', { className: 'dso-card' },
        h('button', {
          type: 'button',
          className: 'dso-head',
          onClick: () => setIsOpen(!isOpen),
          'aria-expanded': isOpen,
        },
          h('div', { className: 'dso-head-info' },
            h('div', { className: 'dso-title' },
              'Multi-Agent Orchestrator',
              h('span', { className: 'dso-badge' }, 'Prompt Caching Optimized')
            ),
            h('div', { className: 'dso-sub' },
              'Decomposes tasks into 12 specialized roles (Architecture, Spec, UI, Code, QA, Docs) with DAG execution.'
            )
          ),
          h('div', { className: `dso-chev ${isOpen ? 'dso-chev-open' : ''}` },
            h(Chevron)
          )
        ),
        isOpen ? h('div', { className: 'dso-body' },
          h('div', { className: 'dso-tabs' },
            h('button', {
              type: 'button',
              className: `dso-tab ${activeTab === 'roles' ? 'dso-tab-active' : ''}`,
              onClick: () => setActiveTab('roles'),
            }, `Agent Profiles (${Object.keys(config?.roles || {}).length})`),
            h('button', {
              type: 'button',
              className: `dso-tab ${activeTab === 'scenarios' ? 'dso-tab-active' : ''}`,
              onClick: () => setActiveTab('scenarios'),
            }, 'Workflow Scenarios (5)'),
            h('button', {
              type: 'button',
              className: `dso-tab ${activeTab === 'metrics' ? 'dso-tab-active' : ''}`,
              onClick: () => setActiveTab('metrics'),
            }, 'Prompt Caching Telemetry'),
            h('button', {
              type: 'button',
              className: `dso-tab ${activeTab === 'kanban' ? 'dso-tab-active' : ''}`,
              onClick: () => setActiveTab('kanban'),
            }, 'Kanban Integration')
          ),
          activeTab === 'roles' ? h(AgentProfilesTab, {
            roles: config?.roles || {},
            onRoleChange: handleRoleChange,
            onAddRole: handleAddRole,
          }) : null,
          activeTab === 'scenarios' ? h(ScenariosTab, {
            scenarios: config?.scenarios || {},
            roles: config?.roles || {},
          }) : null,
          activeTab === 'metrics' ? h(CacheMetricsTab, {
            metrics,
          }) : null,
          activeTab === 'kanban' ? h(KanbanTab, {
            config: config || {},
            onConfigChange: (patch) => setConfig((prev) => ({ ...prev, ...patch })),
          }) : null,
          h('div', { className: 'dso-foot' },
            statusMsg ? h('span', { style: { fontSize: 13, color: 'var(--dsw-alias-state-success-primary)', marginRight: 'auto' } }, statusMsg) : null,
            h('button', {
              className: 'dso-btn dso-btn-primary',
              type: 'button',
              disabled: saving,
              onClick: handleSave,
            }, saving ? 'Saving...' : 'Save Changes')
          )
        ) : null
      )
    }

    function formatElapsedSec(sec) {
      if (sec < 60) return `${sec}s`
      const m = Math.floor(sec / 60)
      const s = sec % 60
      return `${m}m ${s}s`
    }

    function QuickDispatchModal({ onClose, onSuccess }) {
      const [tab, setTab] = useState('pipeline')
      const [taskTitle, setTaskTitle] = useState('')
      const [taskDesc, setTaskDesc] = useState('')
      const [scenarioId, setScenarioId] = useState('auto')
      const [roleId, setRoleId] = useState('architecture')
      const [loading, setLoading] = useState(false)
      const [error, setError] = useState(null)

      const handleDispatch = async () => {
        if (!taskTitle.trim() && tab === 'pipeline') return
        if (!taskDesc.trim() && tab === 'specialist') return
        setLoading(true)
        setError(null)
        try {
          if (tab === 'pipeline') {
            const res = await fetch('/dsh-agent-orchestrator/dispatch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                taskTitle,
                taskDescription: taskDesc || taskTitle,
                scenarioId,
              }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Dispatch failed')
            onSuccess(data.pipeline)
          } else {
            const res = await fetch('/dsh-agent-orchestrator/delegate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                roleId,
                task: taskDesc,
              }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Delegation failed')
            onClose()
          }
        } catch (e) {
          setError(e?.message || String(e))
          setLoading(false)
        }
      }

      return h('div', { className: 'dso-modal-backdrop', onClick: onClose },
        h('div', { className: 'dso-modal', onClick: (e) => e.stopPropagation() },
          h('div', { className: 'dso-modal-head' },
            h('span', null, '🚀 Launch Multi-Agent Orchestrator'),
            h('button', { className: 'dso-dock-btn close', onClick: onClose }, '✕')
          ),
          h('div', { className: 'dso-modal-body' },
            h('div', { className: 'dso-tabs', style: { marginBottom: 8 } },
              h('button', {
                type: 'button',
                className: `dso-tab ${tab === 'pipeline' ? 'dso-tab-active' : ''}`,
                onClick: () => setTab('pipeline'),
              }, 'Full DAG Pipeline'),
              h('button', {
                type: 'button',
                className: `dso-tab ${tab === 'specialist' ? 'dso-tab-active' : ''}`,
                onClick: () => setTab('specialist'),
              }, 'Direct Specialist Subagent')
            ),
            tab === 'pipeline'
              ? h(React.Fragment, null,
                  h('div', { className: 'dso-field' },
                    h('label', { className: 'dso-label' }, 'Objective Title'),
                    h('input', {
                      className: 'dso-input',
                      placeholder: 'e.g. Implement user profile settings card with theme tokens',
                      value: taskTitle,
                      onChange: (e) => setTaskTitle(e.target.value),
                    })
                  ),
                  h('div', { className: 'dso-field' },
                    h('label', { className: 'dso-label' }, 'Scope & Requirements'),
                    h('textarea', {
                      className: 'dso-textarea',
                      placeholder: 'Detailed functional specs, acceptance criteria, constraints...',
                      value: taskDesc,
                      onChange: (e) => setTaskDesc(e.target.value),
                      rows: 3,
                    })
                  ),
                  h('div', { className: 'dso-field' },
                    h('label', { className: 'dso-label' }, 'Topology Scenario'),
                    h('select', {
                      className: 'dso-select',
                      value: scenarioId,
                      onChange: (e) => setScenarioId(e.target.value),
                    },
                      h('option', { value: 'auto' }, 'Auto (Infer based on prompt complexity)'),
                      h('option', { value: 'hotfix' }, 'Hotfix (1 Stage: Triage & Minimal Fix)'),
                      h('option', { value: 'simple' }, 'Simple (2 Stages: Spec + Exec)'),
                      h('option', { value: 'medium' }, 'Medium (4 Stages: Spec -> Design -> Code -> QA)'),
                      h('option', { value: 'complex' }, 'Complex (6 Stages: Full Engineering Lifecycle)'),
                      h('option', { value: 'enterprise' }, 'Enterprise (7 Stages: R&D Spike -> Fullstack -> Gate)')
                    )
                  )
                )
              : h(React.Fragment, null,
                  h('div', { className: 'dso-field' },
                    h('label', { className: 'dso-label' }, 'Target Specialist Role'),
                    h('select', {
                      className: 'dso-select',
                      value: roleId,
                      onChange: (e) => setRoleId(e.target.value),
                    },
                      h('option', { value: 'ui_design' }, 'UI/UX Interface Designer'),
                      h('option', { value: 'architecture' }, 'System Architect (DESIGN.md / ADR)'),
                      h('option', { value: 'spec' }, 'Technical Spec Analyst'),
                      h('option', { value: 'frontend' }, 'Senior Frontend Developer'),
                      h('option', { value: 'backend' }, 'Senior Backend Developer'),
                      h('option', { value: 'qa_tests' }, 'QA Automation Engineer'),
                      h('option', { value: 'refactoring' }, 'Refactoring & Complexity Specialist'),
                      h('option', { value: 'bugfix' }, 'Hotfix & Diagnostic Engineer'),
                      h('option', { value: 'docs' }, 'Documentation Specialist'),
                      h('option', { value: 'research' }, 'Spike & R&D Researcher'),
                      h('option', { value: 'devops' }, 'DevOps & Tooling Specialist')
                    )
                  ),
                  h('div', { className: 'dso-field' },
                    h('label', { className: 'dso-label' }, 'Instructions for Subagent'),
                    h('textarea', {
                      className: 'dso-textarea',
                      placeholder: 'Specific instructions, questions, or requirements for this specialist...',
                      value: taskDesc,
                      onChange: (e) => setTaskDesc(e.target.value),
                      rows: 4,
                    })
                  )
                ),
            error ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12 } }, error) : null
          ),
          h('div', { className: 'dso-modal-foot' },
            h('button', { className: 'dso-btn dso-btn-subtle', onClick: onClose }, 'Cancel'),
            h('button', {
              className: 'dso-btn dso-btn-primary',
              disabled: loading,
              onClick: handleDispatch,
            }, loading ? 'Dispatching...' : tab === 'pipeline' ? 'Start Pipeline' : 'Delegate Subagent')
          )
        )
      )
    }

    function OrchestratorDetailsModal({ pipeline, onClose, onCancel }) {
      const [fullData, setFullData] = useState(pipeline)

      useEffect(() => {
        if (!pipeline?.pipelineId) return
        fetch(`/dsh-agent-orchestrator/pipelines/${encodeURIComponent(pipeline.pipelineId)}`)
          .then((r) => r.json())
          .then((d) => {
            if (d.pipeline) setFullData(d.pipeline)
          })
          .catch(() => {})
      }, [pipeline])

      const stages = fullData?.stages || []
      const isRunning = fullData.status === 'running' || fullData.status === 'pending'

      return h('div', { className: 'dso-modal-backdrop', onClick: onClose },
        h('div', { className: 'dso-modal', style: { maxWidth: 680 }, onClick: (e) => e.stopPropagation() },
          h('div', { className: 'dso-modal-head' },
            h('div', null,
              h('span', null, `DAG Pipeline: ${fullData.taskTitle}`),
              h('span', { className: 'dso-badge', style: { marginLeft: 8 } }, fullData.scenarioTitle || fullData.scenarioId)
            ),
            h('button', { className: 'dso-dock-btn close', onClick: onClose }, '✕')
          ),
          h('div', { className: 'dso-modal-body' },
            h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } },
              fullData.taskDescription
            ),
            h('div', { style: { fontWeight: 600, fontSize: 13, marginTop: 6 } }, 'Execution Stages:'),
            stages.map((stg, idx) => {
              const icon = stg.status === 'completed' ? '✅' : stg.status === 'running' ? '⚡' : stg.status === 'failed' ? '❌' : '⏳'
              const output = fullData.artifacts?.[stg.id] || fullData.stageLogs?.[stg.id]
              return h('div', { key: stg.id || idx, className: 'dso-stage-item' },
                h('div', { className: 'dso-stage-head' },
                  h('span', null, `${icon} ${idx + 1}. ${stg.name} `),
                  h('span', { className: 'dso-agent-role' }, stg.roleName || stg.roleId)
                ),
                output
                  ? h('div', { className: 'dso-stage-log' }, output)
                  : null
              )
            })
          ),
          h('div', { className: 'dso-modal-foot' },
            isRunning && onCancel
              ? h('button', {
                  className: 'dso-btn dso-btn-subtle',
                  style: { color: 'var(--dsw-alias-state-error-primary)', marginRight: 'auto' },
                  onClick: () => onCancel(fullData.pipelineId),
                }, 'Cancel Pipeline')
              : null,
            h('button', { className: 'dso-btn dso-btn-subtle', onClick: onClose }, 'Close')
          )
        )
      )
    }

    // --- Dock Widget above Chat Composer (conversation.input.dock) ---
    function OrchestratorTopBanner(props) {
      const { ctx } = props || {}
      const [activePipeline, setActivePipeline] = useState(null)
      const [recentFinished, setRecentFinished] = useState(null)
      const [dismissedId, setDismissedId] = useState(null)
      const [isDetailsOpen, setIsDetailsOpen] = useState(false)
      const [isQuickOpen, setIsQuickOpen] = useState(false)
      const [now, setNow] = useState(() => Date.now())

      useEffect(() => {
        ensureStyles()
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [])

      const pollStatus = useCallback(async () => {
        try {
          const res = await fetch('/dsh-agent-orchestrator/status')
          if (res.ok) {
            const data = await res.json()
            const active = (data.activePipelines || [])[0] || null
            setActivePipeline(active)

            // If no active, check recent completed/failed within last 60 seconds
            if (!active && data.recentPipelines && data.recentPipelines.length > 0) {
              const latest = data.recentPipelines[0]
              const completedAgo = latest.completedAt ? Date.now() - latest.completedAt : 999999
              if (completedAgo < 60000 && latest.pipelineId !== dismissedId) {
                setRecentFinished(latest)
              } else {
                setRecentFinished(null)
              }
            } else {
              setRecentFinished(null)
            }
          }
        } catch (_) {
          /* safe ignore */
        }
      }, [dismissedId])

      useEffect(() => {
        pollStatus()
        const intervalMs = activePipeline ? 2000 : 5000
        const timer = setInterval(pollStatus, intervalMs)
        return () => clearInterval(timer)
      }, [activePipeline, pollStatus])

      const handleCancel = async (pipelineId) => {
        try {
          await fetch('/dsh-agent-orchestrator/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pipelineId }),
          })
          setIsDetailsOpen(false)
          pollStatus()
        } catch (_) {
          /* safe ignore */
        }
      }

      const currentPipeline = activePipeline || recentFinished
      const isCompleted = currentPipeline?.status === 'completed'
      const isFailed = currentPipeline?.status === 'failed'
      const isRunning = currentPipeline?.status === 'running' || currentPipeline?.status === 'pending'

      if (!currentPipeline || currentPipeline.pipelineId === dismissedId) {
        // Quick Launch Pill in conversation.input.dock
        return h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'dso-dock dso-dock-quick', 'data-orchestrator-dock': 'true' },
            h(
              'button',
              {
                className: 'dso-quicklaunch-btn',
                title: 'Multi-Agent Orchestrator (DAG Pipeline & Specialist Subagents)',
                onClick: () => setIsQuickOpen(true),
              },
              h('span', null, '🚀'),
              h('span', null, 'Orchestrator')
            )
          ),
          isQuickOpen
            ? h(QuickDispatchModal, {
                onClose: () => setIsQuickOpen(false),
                onSuccess: (p) => {
                  setActivePipeline(p)
                  setIsQuickOpen(false)
                },
              })
            : null
        )
      }

      // Format elapsed time
      const startTime = currentPipeline.startedAt || currentPipeline.createdAt || now
      const endTime = currentPipeline.completedAt || now
      const elapsedSec = Math.max(0, Math.floor((endTime - startTime) / 1000))
      const elapsedStr = formatElapsedSec(elapsedSec)

      // Active stage & progress
      const stages = currentPipeline.stages || []
      const totalStages = stages.length
      const completedCount = stages.filter((s) => s.status === 'completed').length
      const activeStage = stages.find((s) => s.status === 'running') || stages.find((s) => s.status === 'pending')

      const bannerClass = `dso-banner ${isCompleted ? 'completed' : ''} ${isFailed ? 'failed' : ''}`

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'dso-dock', 'data-orchestrator-dock': 'true' },
          h(
            'div',
            { className: bannerClass },
            h(
              'div',
              { className: 'dso-banner-left' },
              isRunning
                ? h('div', { className: 'dso-pulse-dot' })
                : h('span', null, isCompleted ? '✅' : '❌'),
              h(
                'span',
                {
                  className: `dso-banner-badge ${isRunning ? 'dso-badge-running' : isCompleted ? 'dso-badge-ok' : 'dso-badge-err'}`,
                },
                isRunning
                  ? `Stage ${completedCount + 1}/${totalStages}`
                  : isCompleted
                  ? 'Done'
                  : 'Failed'
              ),
              currentPipeline.scenarioTitle
                ? h(
                    'span',
                    {
                      className: 'dso-badge',
                      style: { fontSize: 10, padding: '1px 5px' },
                    },
                    currentPipeline.scenarioTitle
                  )
                : null,
              h(
                'span',
                {
                  className: 'dso-banner-title',
                  title: currentPipeline.taskTitle,
                },
                currentPipeline.taskTitle
              ),
              activeStage && isRunning
                ? h(
                    'span',
                    { className: 'dso-banner-stage' },
                    `${activeStage.name} (${activeStage.roleName || activeStage.roleId})`
                  )
                : null
            ),
            h(
              'div',
              { className: 'dso-banner-right' },
              h('span', { className: 'dso-banner-time' }, `⏱ ${elapsedStr}`),
              h(
                'button',
                {
                  className: 'dso-dock-btn',
                  title: 'View Pipeline DAG & Deliverables',
                  onClick: () => setIsDetailsOpen(true),
                },
                'Details'
              ),
              !isRunning
                ? h(
                    'button',
                    {
                      className: 'dso-dock-btn close',
                      title: 'Dismiss Banner',
                      onClick: () => setDismissedId(currentPipeline.pipelineId),
                    },
                    '✕'
                  )
                : null
            )
          )
        ),
        isDetailsOpen
          ? h(OrchestratorDetailsModal, {
              pipeline: currentPipeline,
              onClose: () => setIsDetailsOpen(false),
              onCancel: handleCancel,
            })
          : null,
        isQuickOpen
          ? h(QuickDispatchModal, {
              onClose: () => setIsQuickOpen(false),
              onSuccess: (p) => {
                setActivePipeline(p)
                setIsQuickOpen(false)
              },
            })
          : null
      )
    }


    // --- Issue #5: Specialist Toolview Component (tool.call.toolview) ---
    function SpecialistToolview(props) {
      const [showDiff, setShowDiff] = useState(false)
      const call = props.call || props.toolCall || {}
      const args = call.arguments || call.args || {}
      const result = props.result || props.output || {}
      const roleName = result.roleName || args.roleId || args.name || 'Specialist Worker'
      const modelName = result.model || 'inherited'
      const chip = formatModelChip(modelName, { maxTokens: result.maxTokens })
      const isErr = result.isError || result.status === 'failed'
      const isRunning = !props.result && !props.output
      const diff = result.toolDiff || {}
      const outputText = typeof result.output === 'string' ? result.output : (result.output ? JSON.stringify(result.output, null, 2) : '')

      return h('div', { className: 'dso-toolview-card' },
        h('div', { className: 'dso-toolview-header' },
          h('div', { className: 'dso-toolview-badge' },
            h('span', null, '🤖'),
            h('span', null, roleName),
            h('span', { className: `dso-model-chip ${chip.badgeClass}`, title: chip.tooltip }, chip.text)
          ),
          h('div', { className: `dso-toolview-status-pill ${isRunning ? 'running' : (isErr ? 'err' : 'ok')}` },
            isRunning ? '⏳ Running...' : (isErr ? '🔴 Failed' : '🟢 Completed')
          )
        ),
        diff && (diff.allowed?.length > 0 || diff.strippedSecurity?.length > 0) ?
          h('div', { className: 'dso-toolview-tooldiff' },
            h('div', { className: 'dso-tooldiff-summary', onClick: () => setShowDiff(!showDiff) },
              h('span', null, '🛡️ Tool Permissions:'),
              h('span', null, `${diff.allowed?.length || 0} allowed, ${diff.strippedSecurity?.length || 0} stripped`),
              h(ChevronIcon || FallbackChevron, { style: { transform: showDiff ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' } })
            ),
            showDiff ? h('div', { className: 'dso-tooldiff-pills' },
              (diff.allowed || []).map(t => h('span', { key: t, className: 'dso-pill allow', title: 'Allowed' }, t)),
              (diff.strippedSecurity || []).map(t => h('span', { key: t, className: 'dso-pill blocked', title: 'Blocked by Security Policy' }, t)),
              (diff.denied || []).map(t => h('span', { key: t, className: 'dso-pill denied', title: 'Not in Parent' }, t))
            ) : null
          ) : null,
                outputText ? h('div', { className: 'dso-toolview-deliverable' }, outputText) : null,
        !isRunning && !isErr ? h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
          h('div', { className: 'dso-toolview-callout', style: { flex: 1 } },
            h('span', null, (ctx?.locale ? ctx.locale.bind(NS)('badge.accepted') : '🟢 Subagent result accepted by orchestrator'))
          ),
          h('button', {
            type: 'button',
            className: 'dso-preset-btn',
            title: 'Save this deliverable configuration as a reusable workflow preset (Issue 109)',
            onClick: async () => {
              try {
                await fetch('/dsh-agent-orchestrator/snapshots/save-as-preset', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    snapshotId: result.executionId || args.executionId || `snap-${roleName}`,
                    name: `Preset: ${roleName}`,
                    description: `Created from specialist deliverable [${roleName}]`,
                  }),
                })
              } catch (_) {
                /* safe ignore */
              }
            },
          }, '💾 Save as Preset')
        ) : null
      )
    }

    // --- Header Utility Progress Chip (Goal-style) ---
    // --- Header Utility Progress Chip & Subagent Child Session Badge (Issue #3) ---
    function HeaderOrchestratorWidget(props) {
      const [activePipeline, setActivePipeline] = useState(null)
      const session = props.useSession ? props.useSession(s => s) : props.session

      useEffect(() => {
        ensureStyles()
        const check = () => {
          fetch('/dsh-agent-orchestrator/status')
            .then((r) => r.json())
            .then((d) => {
              const p = (d.activePipelines || [])[0]
              setActivePipeline(p || null)
            })
            .catch(() => {})
        }
        check()
        const interval = setInterval(check, 4000)
        return () => clearInterval(interval)
      }, [])

      // Issue #3: Subagent child session header utility badge
      const subagentMeta = session?.subagent || session?.options?.subagent || (session?.meta && session.meta.subagent)
      const parentId = session?.parentId || session?.options?.parent || (session?.meta && session.meta.parent)
      if (subagentMeta || parentId) {
        const role = subagentMeta?.role || subagentMeta?.label || 'Subagent'
        const model = subagentMeta?.model || session?.options?.model || ''
        const chip = formatModelChip(model)
        return h('div', { className: 'dso-subagent-header-chip' },
          h('span', { className: 'dso-chip-icon' }, '🤖'),
          h('span', { className: 'dso-chip-role' }, role),
          model ? h('span', { className: 'dso-chip-sep' }, '·') : null,
          model ? h('span', { className: `dso-model-chip ${chip.badgeClass}`, title: chip.tooltip }, chip.text) : null,
          parentId ? h('a', {
            href: `#session-${parentId}`,
            className: 'dso-chip-parent-link',
            onClick: (e) => {
              e.preventDefault()
              if (props.ctx?.sessions?.activate) {
                props.ctx.sessions.activate(parentId)
              } else if (window.location) {
                window.location.hash = `session-${parentId}`
              }
            },
            title: `Return to parent session #${parentId}`
          }, `⮌ Parent #${String(parentId).slice(0, 8)}`) : null
        )
      }

      if (!activePipeline) return null

      const total = activePipeline.stages?.length || 0
      const done = activePipeline.stages?.filter((s) => s.status === 'completed').length || 0
      const current = activePipeline.stages?.find((s) => s.status === 'running')

      return h('div', { className: 'dso-widget', title: `Active Pipeline: ${activePipeline.taskTitle}` },
        h('div', { className: 'dso-widget-dot' }),
        h('span', { className: 'dso-widget-badge' }, `${done}/${total}`),
        h('span', null, current ? current.name : 'Orchestrating...')
      )
    }

    // Polling helper to ensure describe mirror sees this namespace
    function refreshMirrorUntilVisible(ctx) {
      const visible = () => {
        try {
          const s = (ctx?.get && ctx.get('lanSettings')) || (ctx?.get && ctx.get('settingsScope')) || ctx?.settingsScope
          const view = s?.describe?.()?.getSnapshot?.()?.view
          return !!view && Array.isArray(view.namespaces) && view.namespaces.some((row) => row.ns === NS)
        } catch (_) {
          return false
        }
      }
      if (visible()) return () => {}
      let tries = 0
      const timer = setInterval(() => {
        if (visible() || tries >= 15) { clearInterval(timer); return }
        tries += 1
        try {
          const s = (ctx?.get && ctx.get('lanSettings')) || (ctx?.get && ctx.get('settingsScope')) || ctx?.settingsScope
          s?.describe?.()?.load?.()
        } catch (_) {
          /* safe ignore */
        }
      }, 1000)
      return () => clearInterval(timer)
    }

    // Plugin Client Exports & Lifecycle
    module.exports.inject = ['slots', 'locale']
    module.exports.apply = function apply(ctx) {
      // Register localized strings via ctx.effect (Issue #115 & #116)
      if (ctx.locale && typeof ctx.locale.register === 'function') {
        const dicts = {
          en: {
            title: 'Multi-Agent Orchestrator',
            subtitle: 'Autonomous multi-agent DAG workflow & prompt caching optimizer',
            description: 'Decompose and execute tasks across specialized autonomous agent roles with prompt caching.',
            'badge.accepted': '🟢 Subagent result accepted by orchestrator',
          },
          zh: {
            title: '多智能体编排器',
            subtitle: '自主多智能体有向无环图工作流与提示词缓存优化器',
            description: '基于提示词缓存优化，将任务分解并在专门的智能体角色之间协同执行。',
            'badge.accepted': '🟢 子代理结果已被编排器接受',
          },
        }
        if (typeof ctx.effect === 'function') {
          ctx.effect(() => ctx.locale.register(NS, dicts), 'dsh-agent-orchestrator: locale')
        } else {
          ctx.locale.register(NS, dicts)
        }
      }

      refreshMirrorUntilVisible(ctx)

      const registerSlotSafe = (name, entry, comp) => {
        try {
          if (typeof ctx.slots?.inject === 'function') {
            ctx.slots.inject(name, () => {
              try {
                return ctx.slots.register(entry, comp)
              } catch (_) {
          /* safe ignore */
        }
            })
          } else if (typeof ctx.slots?.register === 'function') {
            ctx.slots.register(entry, comp)
          }
        } catch (_) {
          /* safe ignore */
        }
      }

      // 1. Primary: Card in settings.plugin.item
      registerSlotSafe(
        'settings.plugin.item',
        {
          name: 'settings.plugin.item',
          key: NS,
          locale: NS,
          order: 25,
          inject: () => ({ ctx }),
        },
        (props) => h(ErrorBoundary, null, h(OrchestratorSettingsCard, { ...props, ctx: props.ctx || ctx }))
      )

      // Issue #128: settings.plugin.item only - redundant top-level settings section fallback removed

      // 3. Dock Widget: conversation.input.dock (above chat input box, like dsh-goal)
      registerSlotSafe(
        'conversation.input.dock',
        {
          name: 'conversation.input.dock',
          id: '@goodandready/dsh-agent-orchestrator',
          order: 10,
          locale: NS,
          inject: (slotProps) => ({ ctx, ...slotProps }),
        },
        (props) => h(ErrorBoundary, null, h(OrchestratorTopBanner, { ...props, ctx: props.ctx || ctx }))
      )

      // 4. Header Widget: conversation.session.header.utilities
      
      // 5. Tool Call View: tool.call.toolview for specialist delegation & agent_run (Issue #5)
      registerSlotSafe(
        'tool.call.toolview',
        {
          name: 'tool.call.toolview',
          key: 'orchestrator_delegate_specialist',
          inject: (slotProps) => ({ ctx, ...slotProps }),
        },
        (props) => h(ErrorBoundary, null, h(SpecialistToolview, { ...props, ctx: props.ctx || ctx }))
      )

      registerSlotSafe(
        'tool.call.toolview',
        {
          name: 'tool.call.toolview',
          key: 'agent_run',
          inject: (slotProps) => ({ ctx, ...slotProps }),
        },
        (props) => h(ErrorBoundary, null, h(SpecialistToolview, { ...props, ctx: props.ctx || ctx }))
      )

      registerSlotSafe(
        'conversation.session.header.utilities',
        {
          name: 'conversation.session.header.utilities',
          id: 'dsh-agent-orchestrator-widget',
          order: 15,
          inject: () => ({ ctx }),
        },
        (props) => h(ErrorBoundary, null, h(HeaderOrchestratorWidget, { ...props, ctx: props.ctx || ctx }))
      )
    }

    return module.exports
  },
})
