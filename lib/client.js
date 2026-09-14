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
          return h('div', { style: { padding: '12px 16px', color: '#ef4444', fontSize: 13 } },
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
.dso-card { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3); border-radius: 12px; list-style: none; margin-bottom: 12px; }
.dso-head { appearance: none; width: 100%; font: inherit; color: inherit; text-align: left; cursor: pointer; background: 0 0; border: 0; border-radius: 12px; display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
.dso-head-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.dso-title { color: var(--dsw-alias-label-primary); font-size: 15px; font-weight: 600; line-height: 1.4; display: flex; align-items: center; gap: 8px; }
.dso-badge { font-size: 11px; font-weight: 500; padding: 2px 7px; border-radius: 6px; background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.25); }
.dso-sub { color: var(--dsw-alias-label-secondary); font-size: 13px; }
.dso-chev { margin-left: auto; flex: none; color: var(--dsw-alias-label-tertiary); transition: transform 0.16s ease; }
.dso-chev-open { transform: rotate(180deg); }
.dso-body { border-top: 1px solid var(--dsw-alias-border-l2); margin: 0 16px; padding: 12px 0 16px; }

.dso-tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--dsw-alias-border-l2); padding-bottom: 10px; margin-bottom: 14px; overflow-x: auto; }
.dso-tab { appearance: none; background: transparent; border: 1px solid transparent; border-radius: 7px; padding: 5px 12px; font-size: 13px; color: var(--dsw-alias-label-secondary); cursor: pointer; font-weight: 500; transition: all 0.15s; }
.dso-tab:hover { color: var(--dsw-alias-label-primary); background: rgba(255, 255, 255, 0.04); }
.dso-tab-active { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.08)); border-color: var(--dsw-alias-border-l2); }

.dso-panel { display: flex; flex-direction: column; gap: 14px; }
.dso-agent-list { display: flex; flex-direction: column; gap: 10px; max-height: 480px; overflow-y: auto; padding-right: 4px; }
.dso-agent-row { border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; padding: 12px; background: rgba(255, 255, 255, 0.02); display: flex; flex-direction: column; gap: 8px; }
.dso-agent-header { display: flex; align-items: center; justify-content: space-between; }
.dso-agent-name { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dso-agent-role { font-size: 12px; color: var(--dsw-alias-label-secondary); }

.dso-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.dso-field { display: flex; flex-direction: column; gap: 4px; }
.dso-label { font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.dso-input, .dso-select { height: 32px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); border-radius: 7px; padding: 0 10px; font-size: 13px; outline: none; }
.dso-textarea { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); border-radius: 7px; padding: 8px 10px; font-size: 12px; font-family: monospace; outline: none; resize: vertical; min-height: 70px; }

.dso-stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; }
.dso-stat-box { border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; padding: 12px; text-align: center; background: rgba(255, 255, 255, 0.02); }
.dso-stat-val { font-size: 20px; font-weight: 700; color: #10b981; }
.dso-stat-lbl { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 4px; }

.dso-foot { border-top: 1px solid var(--dsw-alias-border-l2); display: flex; justify-content: flex-end; align-items: center; gap: 8px; padding-top: 12px; margin-top: 10px; }
.dso-btn { appearance: none; font: inherit; cursor: pointer; border: 1px solid transparent; border-radius: 8px; padding: 6px 14px; font-size: 13px; font-weight: 500; }
.dso-btn-primary { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); }
.dso-btn-subtle { background: transparent; border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }

.dso-widget { display: inline-flex; align-items: center; gap: 8px; padding: 4px 10px; border-radius: 8px; background: rgba(99, 102, 241, 0.12); border: 1px solid rgba(99, 102, 241, 0.25); font-size: 12px; color: var(--dsw-alias-label-primary); }
.dso-widget-dot { width: 7px; height: 7px; border-radius: 50%; background: #10b981; box-shadow: 0 0 6px #10b981; }
.dso-widget-badge { font-weight: 600; color: #818cf8; }
`

    function ensureStyles() {
      if (document.querySelector('style[data-dsh-plugin="dsh-agent-orchestrator"]')) return
      const style = document.createElement('style')
      style.dataset.dshPlugin = 'dsh-agent-orchestrator'
      style.textContent = CSS
      document.head.appendChild(style)
    }

    // --- Tab 1: Agent Profiles ---
    function AgentProfilesTab({ roles = {}, onRoleChange, onAddRole }) {
      const roleList = Object.values(roles)

      return h('div', { className: 'dso-panel' },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h('span', { className: 'dso-sub' }, 'Self-contained agent profiles stored purely in plugin settings (no external files).'),
          h('button', {
            className: 'dso-btn dso-btn-subtle',
            type: 'button',
            onClick: onAddRole,
          }, '+ Add Custom Agent')
        ),
        h('div', { className: 'dso-agent-list' },
          roleList.map((role) =>
            h('div', { key: role.id, className: 'dso-agent-row' },
              h('div', { className: 'dso-agent-header' },
                h('div', null,
                  h('span', { className: 'dso-agent-name' }, role.name),
                  h('span', { className: 'dso-agent-role', style: { marginLeft: 8 } }, `(${role.category || role.id})`)
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
                  h('label', { className: 'dso-label' }, 'Reasoning Effort'),
                  h('select', {
                    className: 'dso-select',
                    value: role.reasoningEffort || 'medium',
                    onChange: (e) => onRoleChange(role.id, { reasoningEffort: e.target.value }),
                  },
                    h('option', { value: 'disabled' }, 'Disabled (None)'),
                    h('option', { value: 'low' }, 'Low (Fast)'),
                    h('option', { value: 'medium' }, 'Medium (Standard)'),
                    h('option', { value: 'high' }, 'High (Deep Thinking)')
                  )
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
          )
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
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: 6,
                    fontSize: 12,
                  },
                },
                  h('span', { style: { fontWeight: 600, width: 20 } }, `${idx + 1}.`),
                  h('span', { style: { flex: 1, color: 'var(--dsw-alias-label-primary)' } }, st.name),
                  h('span', { className: 'dso-badge', style: { fontSize: 10 } }, `Role: ${roles[st.roleId]?.name || st.roleId}`),
                  st.dependsOn?.length > 0
                    ? h('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 } }, `Blocks on: ${st.dependsOn.join(', ')}`)
                    : h('span', { style: { color: '#10b981', fontSize: 11 } }, 'Starts immediately')
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
            h('div', { className: 'dso-stat-val', style: { color: '#38bdf8' } }, (metrics.totalCacheHitTokens || 0).toLocaleString()),
            h('div', { className: 'dso-stat-lbl' }, 'Cached Input Tokens Reused')
          ),
          h('div', { className: 'dso-stat-box' },
            h('div', { className: 'dso-stat-val', style: { color: '#fbbf24' } }, String(metrics.completedPipelines || 0)),
            h('div', { className: 'dso-stat-lbl' }, 'Completed Pipelines')
          )
        ),
        h('div', { style: { padding: 12, background: 'rgba(255, 255, 255, 0.02)', borderRadius: 8, fontSize: 13, lineHeight: 1.6 } },
          h('strong', { style: { color: 'var(--dsw-alias-label-primary)' } }, 'Prompt Caching Mechanics:'),
          h('p', { style: { margin: '6px 0 0', color: 'var(--dsw-alias-label-secondary)' } },
            'All agents sharing the same model receive an identical canonical base anchor (>1024 tokens) and shared task context. Subsequent stages sequentially append prior artifacts, yielding near-instantaneous Time to First Token (TTFT) and an estimated 80–90% cost savings on DeepSeek and Claude models.'
          )
        )
      )
    }

    // --- Main Settings Card ---
    function OrchestratorSettingsCard(props) {
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
            }, 'Prompt Caching Telemetry')
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
          h('div', { className: 'dso-foot' },
            statusMsg ? h('span', { style: { fontSize: 13, color: '#10b981', marginRight: 'auto' } }, statusMsg) : null,
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

    // --- Header Utility Progress Chip (Goal-style) ---
    function HeaderOrchestratorWidget() {
      const [activePipeline, setActivePipeline] = useState(null)

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
        } catch (_) {}
      }, 1000)
      return () => clearInterval(timer)
    }

    // Resilient slot registration helper
    function registerSlotWhenReady(ctx, slotName, registerFn, attempts) {
      let left = attempts || 25
      const tick = () => {
        try {
          const slots = ctx.get ? ctx.get('slots') : ctx.slots
          if (slots && typeof slots.inject === 'function' && typeof slots.register === 'function') {
            try {
              registerFn(slots)
              return
            } catch (err) {
              console.warn('[dsh-agent-orchestrator] failed to register slot ' + slotName + ':', err && err.message)
              return
            }
          }
          if (--left > 0) setTimeout(tick, 400)
          else console.warn('[dsh-agent-orchestrator] slot ' + slotName + ' timed out')
        } catch (err) {
          console.warn('[dsh-agent-orchestrator] slot ' + slotName + ' probe error:', err && err.message)
        }
      }
      tick()
    }

    // Plugin Client Exports & Lifecycle
    module.exports.inject = ['slots', 'locale', 'settingsScope']
    module.exports.apply = function apply(ctx) {
      // Register localized strings
      if (ctx.locale && typeof ctx.locale.register === 'function') {
        try {
          ctx.locale.register(NS, {
            en: {
              title: 'Multi-Agent Orchestrator',
              subtitle: 'Autonomous multi-agent DAG workflow & prompt caching optimizer',
              description: 'Decompose and execute tasks across specialized autonomous agent roles with prompt caching.',
            },
            zh: {
              title: '多智能体编排器',
              subtitle: '自主多智能体有向无环图工作流与提示词缓存优化器',
              description: '基于提示词缓存优化，将任务分解并在专门的智能体角色之间协同执行。',
            },
          })
        } catch (_) {}
      }

      refreshMirrorUntilVisible(ctx)

      // 1. Primary: Card in settings.plugin.item
      registerSlotWhenReady(ctx, 'settings.plugin.item', (slots) => {
        slots.inject('settings.plugin.item', () =>
          slots.register(
            {
              name: 'settings.plugin.item',
              key: NS,
              locale: NS,
              order: 25,
              inject: () => ({ ctx }),
            },
            (props) => h(ErrorBoundary, null, h(OrchestratorSettingsCard, { ...props, ctx: props.ctx || ctx }))
          )
        )
      })

      // 2. Fallback: Sidebar section in settings.section (so settings never disappear)
      registerSlotWhenReady(ctx, 'settings.section', (slots) => {
        slots.inject('settings.section', () =>
          slots.register(
            {
              name: 'settings.section',
              id: '@goodandready/dsh-agent-orchestrator',
              order: 35,
              locale: NS,
              label: () => (ctx.locale ? ctx.locale.bind(NS)('title') : 'Multi-Agent Orchestrator'),
              inject: () => ({ ctx }),
            },
            (props) => h(ErrorBoundary, null, h(OrchestratorSettingsCard, { ...props, ctx: props.ctx || ctx }))
          )
        )
      })

      // 3. Header Widget: conversation.session.header.utilities
      registerSlotWhenReady(ctx, 'conversation.session.header.utilities', (slots) => {
        slots.inject('conversation.session.header.utilities', () =>
          slots.register(
            {
              name: 'conversation.session.header.utilities',
              id: 'dsh-agent-orchestrator-widget',
              order: 15,
              inject: () => ({ ctx }),
            },
            (props) => h(ErrorBoundary, null, h(HeaderOrchestratorWidget, { ...props, ctx: props.ctx || ctx }))
          )
        )
      })
    }

    return module.exports
  },
})
