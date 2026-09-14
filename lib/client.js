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
    const { useState, useEffect, useCallback, useMemo } = React

    const NS = 'dsh-agent-orchestrator'

    // System Chevron icon helper
    let ChevronIcon = null
    try {
      const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
      ChevronIcon = primitives && primitives.IconChevronDownOutline14
    } catch {
      ChevronIcon = null
    }

    const FallbackChevron = () => (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3.5 5.25L7 8.75L10.5 5.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
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

/* Header Utilities Sticky Progress Widget */
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

      return (
        <div className="dso-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="dso-sub">Self-contained agent profiles stored purely in plugin settings (no external files).</span>
            <button
              className="dso-btn dso-btn-subtle"
              type="button"
              onClick={onAddRole}
            >
              + Add Custom Agent
            </button>
          </div>

          <div className="dso-agent-list">
            {roleList.map((role) => (
              <div key={role.id} className="dso-agent-row">
                <div className="dso-agent-header">
                  <div>
                    <span className="dso-agent-name">{role.name}</span>
                    <span className="dso-agent-role" style={{ marginLeft: 8 }}>({role.category || role.id})</span>
                  </div>
                  <span className="dso-badge">Reasoning: {role.reasoningEffort || 'medium'}</span>
                </div>

                <div className="dso-grid-2">
                  <div className="dso-field">
                    <label className="dso-label">Model Provider & Name</label>
                    <input
                      className="dso-input"
                      value={role.defaultModel?.model || ''}
                      onChange={(e) => onRoleChange(role.id, {
                        defaultModel: { ...(role.defaultModel || { provider: 'deepseek' }), model: e.target.value },
                      })}
                      placeholder="e.g. deepseek-chat or claude-3-5-sonnet"
                    />
                  </div>
                  <div className="dso-field">
                    <label className="dso-label">Reasoning Effort</label>
                    <select
                      className="dso-select"
                      value={role.reasoningEffort || 'medium'}
                      onChange={(e) => onRoleChange(role.id, { reasoningEffort: e.target.value })}
                    >
                      <option value="disabled">Disabled (None)</option>
                      <option value="low">Low (Fast)</option>
                      <option value="medium">Medium (Standard)</option>
                      <option value="high">High (Deep Thinking)</option>
                    </select>
                  </div>
                </div>

                <div className="dso-field">
                  <label className="dso-label">SOUL / Specialized Role Instructions</label>
                  <textarea
                    className="dso-textarea"
                    value={role.systemPrompt || ''}
                    onChange={(e) => onRoleChange(role.id, { systemPrompt: e.target.value })}
                    placeholder="Describe role responsibilities, deliverables, and strict boundaries..."
                  />
                </div>

                <div className="dso-field">
                  <label className="dso-label">Skills (comma-separated)</label>
                  <input
                    className="dso-input"
                    value={Array.isArray(role.skills) ? role.skills.join(', ') : ''}
                    onChange={(e) => onRoleChange(role.id, {
                      skills: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    })}
                    placeholder="e.g. project-design-contract, dsh-ui-design"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    }

    // --- Tab 2: Workflow Scenarios ---
    function ScenariosTab({ scenarios = {}, roles = {}, onScenarioChange }) {
      const scenarioList = Object.values(scenarios)

      return (
        <div className="dso-panel">
          <span className="dso-sub">Interactive DAG topologies: stages, blockers, and concurrency permissions.</span>

          {scenarioList.map((sc) => (
            <div key={sc.id} className="dso-agent-row">
              <div className="dso-agent-header">
                <div>
                  <strong style={{ color: 'var(--dsw-alias-label-primary)' }}>{sc.title}</strong>
                  <div className="dso-sub">{sc.description}</div>
                </div>
                <span className="dso-badge">{sc.stages?.length || 0} Stages</span>
              </div>

              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(sc.stages || []).map((st, idx) => (
                  <div
                    key={st.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ fontWeight: 600, width: 20 }}>{idx + 1}.</span>
                    <span style={{ flex: 1, color: 'var(--dsw-alias-label-primary)' }}>{st.name}</span>
                    <span className="dso-badge" style={{ fontSize: 10 }}>Role: {roles[st.roleId]?.name || st.roleId}</span>
                    {st.dependsOn?.length > 0 ? (
                      <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }}>
                        Blocks on: {st.dependsOn.join(', ')}
                      </span>
                    ) : (
                      <span style={{ color: '#10b981', fontSize: 11 }}>Starts immediately</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )
    }

    // --- Tab 3: Prompt Caching Telemetry ---
    function CacheMetricsTab({ metrics = {} }) {
      const hitRatioPct = Math.round((metrics.overallHitRatio || 0) * 100)

      return (
        <div className="dso-panel">
          <div className="dso-stats-grid">
            <div className="dso-stat-box">
              <div className="dso-stat-val">{hitRatioPct}%</div>
              <div className="dso-stat-lbl">Overall Cache Hit Rate</div>
            </div>
            <div className="dso-stat-box">
              <div className="dso-stat-val" style={{ color: '#38bdf8' }}>
                {(metrics.totalCacheHitTokens || 0).toLocaleString()}
              </div>
              <div className="dso-stat-lbl">Cached Input Tokens Reused</div>
            </div>
            <div className="dso-stat-box">
              <div className="dso-stat-val" style={{ color: '#fbbf24' }}>
                {metrics.completedPipelines || 0}
              </div>
              <div className="dso-stat-lbl">Completed Pipelines</div>
            </div>
          </div>

          <div style={{ padding: 12, background: 'rgba(255, 255, 255, 0.02)', borderRadius: 8, fontSize: 13, lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--dsw-alias-label-primary)' }}>Prompt Caching Mechanics:</strong>
            <p style={{ margin: '6px 0 0', color: 'var(--dsw-alias-label-secondary)' }}>
              All agents sharing the same model receive an identical canonical base anchor (>1024 tokens) and shared task context. Subsequent stages sequentially append prior artifacts, yielding near-instantaneous Time to First Token (TTFT) and an estimated 80–90% cost savings on DeepSeek and Claude models.
            </p>
          </div>
        </div>
      )
    }

    // --- Main Settings Card ---
    function OrchestratorSettingsCard({ ctx, t = (k) => k }) {
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

      return (
        <li className="dso-card">
          <button
            type="button"
            className="dso-head"
            onClick={() => setIsOpen(!isOpen)}
            aria-expanded={isOpen}
          >
            <div className="dso-head-info">
              <div className="dso-title">
                Multi-Agent Orchestrator
                <span className="dso-badge">Prompt Caching Optimized</span>
              </div>
              <div className="dso-sub">
                Decomposes tasks into 12 specialized roles (Architecture, Spec, UI, Code, QA, Docs) with DAG execution.
              </div>
            </div>
            <div className={`dso-chev ${isOpen ? 'dso-chev-open' : ''}`}>
              <Chevron />
            </div>
          </button>

          {isOpen && (
            <div className="dso-body">
              <div className="dso-tabs">
                <button
                  type="button"
                  className={`dso-tab ${activeTab === 'roles' ? 'dso-tab-active' : ''}`}
                  onClick={() => setActiveTab('roles')}
                >
                  Agent Profiles ({Object.keys(config?.roles || {}).length})
                </button>
                <button
                  type="button"
                  className={`dso-tab ${activeTab === 'scenarios' ? 'dso-tab-active' : ''}`}
                  onClick={() => setActiveTab('scenarios')}
                >
                  Workflow Scenarios (5)
                </button>
                <button
                  type="button"
                  className={`dso-tab ${activeTab === 'metrics' ? 'dso-tab-active' : ''}`}
                  onClick={() => setActiveTab('metrics')}
                >
                  Prompt Caching Telemetry
                </button>
              </div>

              {activeTab === 'roles' && (
                <AgentProfilesTab
                  roles={config?.roles || {}}
                  onRoleChange={handleRoleChange}
                  onAddRole={handleAddRole}
                />
              )}

              {activeTab === 'scenarios' && (
                <ScenariosTab
                  scenarios={config?.scenarios || {}}
                  roles={config?.roles || {}}
                />
              )}

              {activeTab === 'metrics' && (
                <CacheMetricsTab metrics={metrics} />
              )}

              <div className="dso-foot">
                {statusMsg && (
                  <span style={{ fontSize: 13, color: '#10b981', marginRight: 'auto' }}>
                    {statusMsg}
                  </span>
                )}
                <button
                  className="dso-btn dso-btn-primary"
                  type="button"
                  disabled={saving}
                  onClick={handleSave}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}
        </li>
      )
    }

    // --- Header Utility Progress Chip (Goal-style) ---
    function HeaderOrchestratorWidget({ ctx }) {
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

      return (
        <div className="dso-widget" title={`Active Pipeline: ${activePipeline.taskTitle}`}>
          <div className="dso-widget-dot" />
          <span className="dso-widget-badge">
            {done}/{total}
          </span>
          <span>{current ? current.name : 'Orchestrating...'}</span>
        </div>
      )
    }

    // Plugin Client Apply
    module.exports.inject = ['slots', 'locale']
    module.exports.apply = function apply(ctx) {
      // Register locale
      if (ctx.locale && typeof ctx.locale.register === 'function') {
        ctx.locale.register(NS, {
          en: {
            title: 'Multi-Agent Orchestrator',
            description: 'Decompose and execute tasks across specialized autonomous agent roles with prompt caching.',
          },
          zh: {
            title: '多智能体编排器',
            description: '基于提示词缓存优化，将任务分解并在专门的智能体角色之间协同执行。',
          },
        })
      }

      // 1. Register Settings Card in settings.plugin.item
      if (ctx.slots && typeof ctx.slots.register === 'function') {
        ctx.slots.register(
          {
            name: 'settings.plugin.item',
            key: NS,
            locale: NS,
            inject: () => ({ ctx }),
          },
          OrchestratorSettingsCard
        )

        // 2. Register Sticky Progress Widget in session header utilities
        try {
          ctx.slots.register(
            {
              name: 'conversation.session.header.utilities',
              id: '@goodandready/dsh-agent-orchestrator',
              inject: () => ({ ctx }),
            },
            HeaderOrchestratorWidget
          )
        } catch {}
      }
    }

    return module.exports
  },
})

