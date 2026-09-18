import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as modelSelection from '../lib/pipeline/model-selection.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

describe('Batch 7: Issue #130 & #131 - Server Logger Guard & Dead Exports Audit', () => {
  it('Issue #130: Server-side lib/ contains ZERO console.* calls', () => {
    const libDir = path.join(rootDir, 'lib')
    const violations = []

    function scanDir(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          scanDir(full)
        } else if (entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'client.js') {
          const content = fs.readFileSync(full, 'utf8')
          const lines = content.split(/\r?\n/)
          lines.forEach((line, idx) => {
            const trimmed = line.trim()
            if (trimmed.startsWith('//') || trimmed.startsWith('/*')) return
            if (/console\.(log|warn|error|debug|info|trace)\b/.test(line)) {
              violations.push({
                file: path.relative(rootDir, full),
                line: idx + 1,
                content: trimmed,
              })
            }
          })
        }
      }
    }

    scanDir(libDir)

    assert.equal(
      violations.length,
      0,
      `Expected 0 console.* calls in server modules, but found ${violations.length}:\n` +
        violations.map((v) => `  ${v.file}:${v.line} - ${v.content}`).join('\n')
    )
  })

  it('Issue #131: Eliminates dead public exports CAPABILITY_TAGS and MAX_TOKENS_BY_CAPABILITY', () => {
    assert.equal(
      modelSelection.CAPABILITY_TAGS,
      undefined,
      'CAPABILITY_TAGS must not be exported'
    )
    assert.equal(
      modelSelection.MAX_TOKENS_BY_CAPABILITY,
      undefined,
      'MAX_TOKENS_BY_CAPABILITY must not be exported'
    )

    // Functionality of resolveMaxTokens remains intact via internal lookup
    assert.equal(modelSelection.resolveMaxTokens({ capabilities: ['fast'] }), 2048)
    assert.equal(modelSelection.resolveMaxTokens({ capabilities: ['reasoning'] }), 8192)
    assert.equal(modelSelection.resolveMaxTokens({ capabilities: ['general'] }), 4096)
  })
})
