import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

test('Issue #137: lib/index.js resolves sessionsService defensively without bare ctx.sessions', () => {
  const indexPath = path.resolve('lib/index.js')
  const content = fs.readFileSync(indexPath, 'utf-8')

  // Direct ctx.sessions access in Cordis context causes crash if not injected
  assert.equal(
    content.includes('sessionsService: ctx.sessions'),
    false,
    'lib/index.js must NOT access bare ctx.sessions directly'
  )

  // Must use safe ctx.get fallback
  assert.equal(
    content.includes("ctx.get('sessions', false)") || content.includes('ctx.get("sessions", false)'),
    true,
    'lib/index.js must use defensive ctx.get("sessions", false) lookup'
  )
})
