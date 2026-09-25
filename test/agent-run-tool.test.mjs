import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

test('apply: registers agent_run tool with native parameters and executor', async () => {
  const registeredTools = []
  const registeredSections = []

  const mockCtx = {
    inject: (deps, cb) => {
      // Mock settings service
      if (deps.includes('settings')) {
        cb({
          settings: {
            register: () => ({
              get: () => ({}),
              set: async () => {},
            }),
          },
        })
      }
      // Mock systemPrompt service
      if (deps.includes('systemPrompt')) {
        cb({
          systemPrompt: {
            section: (opts) => {
              registeredSections.push(opts)
              return () => {}
            },
          },
          effect: (fn) => fn(),
        })
      }
    },
    effect: (fn) => fn(),
    tools: {
      register: (tool) => {
        registeredTools.push(tool)
        return () => {}
      },
      schemas: () => [{ name: 'view_file' }, { name: 'write_to_file' }],
    },
    subagents: {
      getProvider: () => ({ name: 'spawn' }),
      start: async (provider, req) => ({
        id: 'run-test-111',
        result: Promise.resolve({
          stopReason: 'completed',
          output: [{ type: 'text', text: 'Subagent code task completed successfully.' }],
        }),
        dispose: async () => {},
      }),
    },
    webServer: {
      register: () => {},
    },
    llm: {},
    on: () => () => {},
    emit: () => {},
  }

  apply(mockCtx, { enabled: true })

  // 1. Verify agent_run is registered
  const agentRunTool = registeredTools.find((t) => t.name === 'agent_run')
  assert.ok(agentRunTool, 'agent_run tool must be registered')
  assert.equal(agentRunTool.name, 'agent_run')
  assert.ok(agentRunTool.parameters.properties?.name || agentRunTool.parameters.name)
  assert.ok(agentRunTool.parameters.properties?.task || agentRunTool.parameters.task)

  // 2. Execute agent_run
  const result = await agentRunTool.execute(
    {
      name: 'code',
      task: 'Write a utility function',
      mode: 'one-shot',
    },
    { sessionId: 'parent-test-session' }
  )

  assert.equal(result.kind, 'foreground')
  assert.equal(result.childSessionId, 'run-test-111')
  assert.equal(result.status, 'completed')
  assert.match(result.output, /Subagent code task completed/)
})
