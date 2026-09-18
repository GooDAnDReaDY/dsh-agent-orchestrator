import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isTrustedWriteRequest, isLoopbackAddress, getClientIp, parseBoundedJsonBody } from '../lib/http-guard.js'
import { Readable } from 'node:stream'

describe('HTTP Guard and Route Security (Issue #113)', () => {
  it('identifies loopback addresses correctly', () => {
    assert.equal(isLoopbackAddress('127.0.0.1'), true)
    assert.equal(isLoopbackAddress('127.0.1.1'), true)
    assert.equal(isLoopbackAddress('::1'), true)
    assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)

    assert.equal(isLoopbackAddress('192.168.1.111'), false)
    assert.equal(isLoopbackAddress('10.0.0.1'), false)
    assert.equal(isLoopbackAddress('8.8.8.8'), false)
    assert.equal(isLoopbackAddress(''), false)
    assert.equal(isLoopbackAddress(null), false)
  })

  it('allows same-origin requests when Origin matches Host', () => {
    const req = {
      headers: {
        host: 'localhost:3080',
        origin: 'http://localhost:3080',
      },
    }
    assert.equal(isTrustedWriteRequest(req), true)
  })

  it('blocks cross-origin requests when Origin does not match Host', () => {
    const req = {
      headers: {
        host: 'localhost:3080',
        origin: 'http://evil-attacker.com',
      },
    }
    assert.equal(isTrustedWriteRequest(req), false)
  })

  it('blocks null origin', () => {
    const req = {
      headers: {
        host: 'localhost:3080',
        origin: 'null',
      },
    }
    assert.equal(isTrustedWriteRequest(req), false)
  })

  it('allows loopback calls when Origin and Sec-Fetch-Site are absent', () => {
    const req = {
      headers: {
        host: 'localhost:3080',
      },
      socket: {
        remoteAddress: '127.0.0.1',
      },
    }
    assert.equal(isTrustedWriteRequest(req), true)
  })

  it('blocks non-loopback calls when Origin and Sec-Fetch-Site are absent', () => {
    const req = {
      headers: {
        host: 'localhost:3080',
      },
      socket: {
        remoteAddress: '192.168.1.55',
      },
    }
    assert.equal(isTrustedWriteRequest(req), false)
  })

  it('validates sec-fetch-site header', () => {
    assert.equal(
      isTrustedWriteRequest({
        headers: {
          host: 'localhost:3080',
          'sec-fetch-site': 'same-origin',
        },
      }),
      true
    )

    assert.equal(
      isTrustedWriteRequest({
        headers: {
          host: 'localhost:3080',
          'sec-fetch-site': 'cross-site',
        },
      }),
      false
    )
  })

  it('parseBoundedJsonBody parses valid JSON within limit', async () => {
    const stream = Readable.from([Buffer.from(JSON.stringify({ taskTitle: 'Test', scenarioId: 'simple' }))])
    const body = await parseBoundedJsonBody(stream, 1024)
    assert.equal(body.taskTitle, 'Test')
    assert.equal(body.scenarioId, 'simple')
  })

  it('parseBoundedJsonBody rejects payload exceeding byte limit (413)', async () => {
    const hugeChunk = 'x'.repeat(2048)
    const stream = Readable.from([Buffer.from(JSON.stringify({ data: hugeChunk }))])
    await assert.rejects(
      async () => {
        await parseBoundedJsonBody(stream, 512)
      },
      (err) => {
        assert.equal(err.statusCode, 413)
        assert.match(err.message, /Payload Too Large/)
        return true
      }
    )
  })
})
