import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

describe('Batch 7: Issue #134 - Client Service Injection Alignment', () => {
  const pkgPath = path.join(rootDir, 'package.json')
  const clientPath = path.join(rootDir, 'lib', 'client.js')

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const clientContent = fs.readFileSync(clientPath, 'utf8')

  it('package.json: dsh.client.inject lists required client service dependencies', () => {
    assert.ok(pkg.dsh?.client, 'package.json must contain dsh.client configuration')
    assert.ok(Array.isArray(pkg.dsh.client.inject), 'dsh.client.inject must be an array')
    assert.deepEqual(
      [...pkg.dsh.client.inject].sort(),
      ['@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-slots'].sort(),
      'package.json dsh.client.inject must declare locale and slots services'
    )
  })

  it('lib/client.js: module.exports.inject matches active services and omits unused settingsScope', () => {
    let loadedModule = null
    const fakeWindow = {
      __ModuleLoader__: {
        load: ({ factory }) => {
          const fakeRequire = (name) => {
            if (name === 'react') {
              return {
                createElement: () => ({}),
                useState: (init) => [init, () => {}],
                useEffect: () => {},
                useCallback: (fn) => fn,
                Component: class {},
              }
            }
            return {}
          }
          loadedModule = factory(fakeRequire)
        },
      },
    }

    const runInScope = new Function('window', 'document', clientContent)
    runInScope(fakeWindow, {
      querySelector: () => null,
      createElement: () => ({ dataset: {} }),
      head: { appendChild: () => {} },
    })

    assert.ok(loadedModule, 'Client module loaded')
    assert.ok(Array.isArray(loadedModule.inject), 'module.exports.inject must be an array')
    assert.deepEqual(
      [...loadedModule.inject].sort(),
      ['locale', 'slots'].sort(),
      'module.exports.inject must contain only slots and locale'
    )
    assert.equal(
      loadedModule.inject.includes('settingsScope'),
      false,
      'settingsScope must not be declared in module.exports.inject'
    )
  })

  it('lib/client.js: zero usages of ctx.settingsScope in code', () => {
    assert.equal(
      clientContent.includes('ctx.settingsScope'),
      false,
      'lib/client.js must never reference ctx.settingsScope'
    )
  })
})
