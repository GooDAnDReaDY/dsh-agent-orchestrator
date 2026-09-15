import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

test('client: registers header.utilities and tool.call.toolview for specialist delegation', () => {
  let loadedModule = null
  globalThis.window = {
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        loadedModule = factory((pkg) => {
          if (pkg === 'react') {
            return {
              createElement: (type, props, ...children) => ({ type, props, children }),
              useState: (init) => [init, () => {}],
              useEffect: () => {},
              useCallback: (fn) => fn,
              Component: class Component {},
            }
          }
          return {}
        })
      },
    },
  }

  // Load client.js code
  const clientPath = path.resolve('lib/client.js')
  const clientCode = fs.readFileSync(clientPath, 'utf8')
  new Function(clientCode)()

  assert.ok(loadedModule, 'client module must be loaded into __ModuleLoader__')
  assert.ok(typeof loadedModule.apply === 'function', 'client module must export apply function')

  const registeredSlots = []
  const mockCtx = {
    slots: {
      register: (entry, comp) => {
        registeredSlots.push({ entry, comp })
      },
      inject: (name, cb) => cb(),
    },
    locale: {
      register: () => {},
    },
  }

  loadedModule.apply(mockCtx)

  // 1. Verify header utilities slot registration (Issue #3)
  const headerSlot = registeredSlots.find((s) => s.entry?.name === 'conversation.session.header.utilities')
  assert.ok(headerSlot, 'conversation.session.header.utilities slot must be registered')

  // 2. Verify tool.call.toolview slot registration for agent_run and orchestrator_delegate_specialist (Issue #5)
  const toolviewDelegate = registeredSlots.find(
    (s) => s.entry?.name === 'tool.call.toolview' && s.entry?.key === 'orchestrator_delegate_specialist'
  )
  assert.ok(toolviewDelegate, 'tool.call.toolview for orchestrator_delegate_specialist must be registered')

  const toolviewAgentRun = registeredSlots.find(
    (s) => s.entry?.name === 'tool.call.toolview' && s.entry?.key === 'agent_run'
  )
  assert.ok(toolviewAgentRun, 'tool.call.toolview for agent_run must be registered')
})
