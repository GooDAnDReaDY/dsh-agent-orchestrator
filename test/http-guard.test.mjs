import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isTrustedWriteRequest, isLoopbackAddress, getClientIp, parseBoundedJsonBody } from '../lib/http-guard.js'
import { toPublicPipelineDto } from '../lib/routes.js'
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

  it('allows loopback calls when Origin is absent', () => {
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

  it('blocks non-loopback calls when Origin is absent (even with Sec-Fetch-Site: same-origin)', () => {
    // Header-only remote callers cannot bypass via fake Sec-Fetch-Site
    const req = {
      headers: {
        host: 'localhost:3080',
        'sec-fetch-site': 'same-origin',
      },
      socket: {
        remoteAddress: '192.168.1.55',
      },
    }
    assert.equal(isTrustedWriteRequest(req), false)
  })

  it('validates sec-fetch-site with matching Origin', () => {
    // Legitimate browser call with matching origin and sec-fetch-site: same-origin -> allowed
    assert.equal(
      isTrustedWriteRequest({
        headers: {
          host: 'localhost:3080',
          origin: 'http://localhost:3080',
          'sec-fetch-site': 'same-origin',
        },
      }),
      true
    )

    // Cross-site request rejected even if Origin matches Host
    assert.equal(
      isTrustedWriteRequest({
        headers: {
          host: 'localhost:3080',
          origin: 'http://localhost:3080',
          'sec-fetch-site': 'cross-site',
        },
      }),
      false
    )
  })

  it('supports LAN reverse-proxy bridge path via X-Forwarded-Host', () => {
    // dsh-lanmode forwarding request for https://dsh.local
    const req = {
      headers: {
        host: '127.0.0.1:3080',
        'x-forwarded-host': 'dsh.local:3080',
        origin: 'https://dsh.local:3080',
        'sec-fetch-site': 'same-origin',
      },
      socket: {
        remoteAddress: '127.0.0.1',
      },
    }
    assert.equal(isTrustedWriteRequest(req), true)
  })

  it('allows authorized requests via Bearer token', () => {
    const req = {
      headers: {
        host: 'localhost:3080',
        authorization: 'Bearer orchestrator-bridge-secret-token',
      },
      socket: {
        remoteAddress: '192.168.1.99',
      },
    }
    assert.equal(isTrustedWriteRequest(req), true)
  })

  it('toPublicPipelineDto strips sensitive task details, outputs, and errors (Issue #113)', () => {
    const fullPipeline = {
      pipelineId: 'pipe-test-123',
      scenarioId: 'complex',
      scenarioTitle: 'Complex Enterprise Architecture',
      taskTitle: 'Classified Proprietary Backend Refactoring',
      taskDescription: 'Detailed internal trade secrets and API keys: sk-secret-token-here',
      status: 'running',
      createdAt: 1789400000000,
      startedAt: 1789400000100,
      completedAt: null,
      durationMs: 4500,
      stages: [
        {
          id: 'spec',
          name: 'Requirements Analysis',
          roleId: 'spec',
          status: 'completed',
          subtaskScope: 'Confidential client specification and functional requirements',
          output: 'Sensitive analysis document with private server IPs: 10.0.0.5',
          error: null,
        },
        {
          id: 'backend',
          name: 'Core Implementation',
          roleId: 'backend',
          status: 'running',
          subtaskScope: 'Implement private database queries and encryption keys',
          output: null,
          error: 'Connection failed to internal-db.cluster.local:5432 with password auth failure',
        },
      ],
      stateMap: {
        spec: { output: 'Sensitive analysis document', metrics: { promptTokens: 500 } },
      },
      artifacts: {
        'spec.md': 'Confidential content',
      },
    }

    const dto = toPublicPipelineDto(fullPipeline)

    // Structural metadata retained
    assert.equal(dto.pipelineId, 'pipe-test-123')
    assert.equal(dto.scenarioId, 'complex')
    assert.equal(dto.scenarioTitle, 'Complex Enterprise Architecture')
    assert.equal(dto.status, 'running')
    assert.equal(dto.startedAt, 1789400000100)
    assert.equal(dto.durationMs, 4500)
    assert.equal(dto.stages.length, 2)
    assert.equal(dto.stages[0].id, 'spec')
    assert.equal(dto.stages[0].status, 'completed')
    assert.equal(dto.stages[1].id, 'backend')
    assert.equal(dto.stages[1].status, 'running')

    // Absolutely NO leak of user tasks, scopes, outputs, errors, stateMap, or artifacts
    assert.equal(dto.taskTitle, undefined)
    assert.equal(dto.taskDescription, undefined)
    assert.equal(dto.stateMap, undefined)
    assert.equal(dto.artifacts, undefined)
    assert.equal(dto.stages[0].subtaskScope, undefined)
    assert.equal(dto.stages[0].output, undefined)
    assert.equal(dto.stages[1].subtaskScope, undefined)
    assert.equal(dto.stages[1].output, undefined)
    assert.equal(dto.stages[1].error, undefined)

    const serialized = JSON.stringify(dto)
    assert.equal(serialized.includes('Classified'), false)
    assert.equal(serialized.includes('sk-secret-token'), false)
    assert.equal(serialized.includes('internal-db.cluster.local'), false)
    assert.equal(serialized.includes('10.0.0.5'), false)
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
