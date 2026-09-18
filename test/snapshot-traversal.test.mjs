import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { EventEmitter } from 'node:events'
import { SnapshotManager } from '../lib/pipeline/snapshots.js'
import { registerOrchestratorRoutes } from '../lib/routes.js'

function createMockReq(bodyObj) {
  const json = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj)
  const ee = new EventEmitter()
  ee.method = 'POST'
  ee.headers = {
    host: '127.0.0.1:3000',
    'content-type': 'application/json',
  }
  ee.socket = { remoteAddress: '127.0.0.1' }
  ee.pause = () => {}
  process.nextTick(() => {
    ee.emit('data', Buffer.from(json))
    ee.emit('end')
  })
  return ee
}

function createMockRes() {
  let statusCode = 200
  let responseData = null
  return {
    setHeader: () => {},
    end: (data) => {
      if (data) {
        try { responseData = JSON.parse(data) } catch (_) { responseData = data }
      }
    },
    set statusCode(code) { statusCode = code },
    get statusCode() { return statusCode },
    get responseData() { return responseData },
  }
}

describe('Batch 7: Issue #135 - Path Traversal Hardening on Snapshots', () => {
  const tmpDir = path.join(os.tmpdir(), 'orchestrator-snap-traversal-' + Date.now())

  it('SnapshotManager: _pathFor allows valid alphanumeric/dash/underscore IDs', () => {
    const mgr = new SnapshotManager({ baseDir: tmpDir })
    const validIds = ['snap-1234', 'custom_run_01', 'StageA-B_123', 'a'.repeat(64)]

    for (const id of validIds) {
      const p = mgr._pathFor(id)
      assert.ok(p.startsWith(path.resolve(tmpDir) + path.sep))
      assert.ok(p.endsWith(id + '.json'))
    }
  })

  it('SnapshotManager: _pathFor strictly blocks traversal sequences and separators', () => {
    const mgr = new SnapshotManager({ baseDir: tmpDir })
    const malicious = [
      '../../etc/passwd',
      '..\\windows\\win.ini',
      '/etc/shadow',
      'C:\\boot.ini',
      'folder/subfile',
      'folder\\subfile',
      '../test',
      '..',
      '.',
      '',
      null,
      undefined,
      'invalid*char',
      'invalid char',
      'snap$var',
      'a'.repeat(65),
    ]

    for (const id of malicious) {
      assert.throws(
        () => mgr._pathFor(id),
        /Invalid snapshotId|Path traversal/i,
        `Expected traversal error for id: "${id}"`
      )
    }
  })

  it('SnapshotManager: getSnapshot returns null on traversal attempt without throwing', () => {
    const mgr = new SnapshotManager({ baseDir: tmpDir })
    assert.equal(mgr.getSnapshot('../../package'), null)
    assert.equal(mgr.getSnapshot('..\\secret'), null)
    assert.equal(mgr.getSnapshot(''), null)
    assert.equal(mgr.getSnapshot(null), null)
  })

  it('SnapshotManager: createSnapshot prevents directory traversal on custom ID', () => {
    const mgr = new SnapshotManager({ baseDir: tmpDir })
    assert.throws(
      () => mgr.createSnapshot({ id: '../../malicious-snap' }),
      /Invalid snapshotId|Path traversal/i
    )
  })

  it('SnapshotManager: saveAsPreset throws upfront on traversal ID', () => {
    const mgr = new SnapshotManager({ baseDir: tmpDir })
    assert.throws(
      () => mgr.saveAsPreset('../../target-file'),
      /Invalid snapshotId|Path traversal/i
    )
  })

  it('HTTP Route: POST /snapshots/save-as-preset returns 400 Bad Request on traversal attempt', async () => {
    const mgr = new SnapshotManager({ baseDir: tmpDir })
    const mockRoutes = new Map()

    const mockCtx = {
      effect: (fn) => fn(),
      webServer: {
        register: (route) => {
          mockRoutes.set(route.path, route.handler)
          return () => {}
        },
      },
    }

    registerOrchestratorRoutes(mockCtx, {
      store: {},
      runner: {},
      getConfig: () => ({ scenarios: {} }),
      updateConfig: async () => {},
      callLlm: async () => {},
      snapshotManager: mgr,
    })

    const handler = mockRoutes.get('/dsh-agent-orchestrator/snapshots/save-as-preset')
    assert.ok(handler, 'Route handler must be registered')

    // Test traversal payloads
    const badIds = ['../../etc/passwd', '..\\win.ini', 'sub/dir', 'invalid*name', '']

    for (const badId of badIds) {
      const req = createMockReq({ snapshotId: badId })
      const res = createMockRes()

      await handler(req, res)
      assert.equal(res.statusCode, 400, `Expected 400 for snapshotId: "${badId}", got ${res.statusCode}`)
      assert.ok(res.responseData?.error, 'Response must include error message')
    }
  })
})
