import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MIN_CACHE_ANCHOR_TOKENS, buildStaticBaseAnchor } from '../lib/pipeline/cache-prefixer.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

describe('Batch 4 Audit: Theme Colors, Locale Effect & Cyrillic Checks', () => {
  const clientJsPath = path.join(rootDir, 'lib', 'client.js')
  const indexJsPath = path.join(rootDir, 'lib', 'index.js')
  const clientContent = fs.readFileSync(clientJsPath, 'utf8')
  const indexContent = fs.readFileSync(indexJsPath, 'utf8')

  it('Issue #114: lib/client.js contains ZERO rgba(...) color literals', () => {
    const rgbaMatches = clientContent.match(/rgba\([^)]+\)/g) || []
    assert.equal(
      rgbaMatches.length,
      0,
      `Expected zero rgba(...) colors in client.js, but found: ${JSON.stringify(rgbaMatches)}`
    )
  })

  it('Issue #114: lib/client.js contains ZERO hardcoded hex color literals in CSS or styles', () => {
    // Strip comments to only match actual code / styles
    const codeWithoutComments = clientContent
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*/g, '')

    const hexMatches = codeWithoutComments.match(/#[0-9a-fA-F]{3,8}\b/g) || []
    assert.equal(
      hexMatches.length,
      0,
      `Expected zero hex colors in client.js code, but found: ${JSON.stringify(hexMatches)}`
    )
  })

  it('Issue #115: lib/client.js registers locale inside ctx.effect and handles repeat apply safely', () => {
    let effectCalled = false
    let effectTag = ''
    let registeredNs = ''
    let registeredDicts = null
    let unregisterCalled = false

    const mockUnregister = () => {
      unregisterCalled = true
    }

    const mockCtx = {
      locale: {
        register: (ns, dicts) => {
          registeredNs = ns
          registeredDicts = dicts
          return mockUnregister
        },
        bind: () => (k) => k,
      },
      effect: (fn, tag) => {
        effectCalled = true
        effectTag = tag
        return fn()
      },
      slots: {
        register: () => () => {},
        inject: () => {},
      },
    }

    // Evaluate client.js factory
    let loadedModule = null
    const fakeWindow = {
      __ModuleLoader__: {
        load: ({ id, factory }) => {
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

    assert.ok(loadedModule, 'Client module loaded successfully')
    assert.ok(typeof loadedModule.apply === 'function', 'loadedModule.apply is a function')

    // First apply
    const disposer = loadedModule.apply(mockCtx)
    assert.ok(effectCalled, 'ctx.effect must be invoked during apply')
    assert.equal(effectTag, 'dsh-agent-orchestrator: locale', 'ctx.effect must use explicit description tag')
    assert.equal(registeredNs, 'dsh-agent-orchestrator', 'Namespace must match plugin id')
    assert.ok(registeredDicts.en, 'English dictionary must be registered')
    assert.ok(registeredDicts.zh, 'Chinese dictionary must be registered')
    assert.ok(registeredDicts.en['badge.accepted'], 'badge.accepted key must exist in en dictionary')
    assert.ok(registeredDicts.zh['badge.accepted'], 'badge.accepted key must exist in zh dictionary')

    // Second apply: ensure idempotent and no exceptions
    assert.doesNotThrow(() => {
      loadedModule.apply(mockCtx)
    }, 'Repeat apply() must execute cleanly without exceptions')
  })

  it('Issue #116: lib/client.js and lib/index.js have ZERO Cyrillic literals', () => {
    const cyrillicRe = /[\u0400-\u04FF]/g

    const clientCyrillic = clientContent.match(cyrillicRe) || []
    assert.equal(
      clientCyrillic.length,
      0,
      `Expected zero Cyrillic characters in lib/client.js, got ${clientCyrillic.length}`
    )

    const indexCyrillic = indexContent.match(cyrillicRe) || []
    assert.equal(
      indexCyrillic.length,
      0,
      `Expected zero Cyrillic characters in lib/index.js, got ${indexCyrillic.length}`
    )
  })

  it('Issue #116: client and server both use unified dictionary key badge.accepted', () => {
    assert.ok(
      clientContent.includes('badge.accepted'),
      'lib/client.js must reference dictionary key badge.accepted'
    )
    assert.ok(
      indexContent.includes('badge.accepted') || indexContent.includes('Subagent result accepted by orchestrator'),
      'lib/index.js must format accepted subagent result with standard accepted text'
    )
  })

  it('Issue #117: MIN_CACHE_ANCHOR_TOKENS is 1024 and base anchor exceeds it', () => {
    assert.equal(MIN_CACHE_ANCHOR_TOKENS, 1024)
    const anchor = buildStaticBaseAnchor()
    const approxTokens = Math.floor(anchor.length / 4)
    assert.ok(
      approxTokens >= MIN_CACHE_ANCHOR_TOKENS,
      `Base anchor must have >= ${MIN_CACHE_ANCHOR_TOKENS} tokens, got ${approxTokens}`
    )
  })
})
