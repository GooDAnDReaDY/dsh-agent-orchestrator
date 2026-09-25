/**
 * HTTP guard utilities for protecting write endpoints (POST/PUT/DELETE)
 * against drive-by CSRF, unauthorized cross-network access, and cross-origin tampering.
 *
 * Implements Issue #113:
 * 1. Loopback / Origin / Host validation with LAN reverse proxy (X-Forwarded-Host) support
 * 2. Sec-Fetch-Site and Referer verification (Fetch Metadata is not authentication)
 * 3. Explicit Bearer token authorization support (bridge path)
 * 4. Body size limiter (default 1MB) with fail-closed rejection
 */

export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024 // 1MB

export function isLoopbackAddress(ip) {
  if (!ip || typeof ip !== 'string') return false
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip.startsWith('127.')
  )
}

export function getClientIp(req) {
  return (
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    req.info?.remoteAddress ||
    ''
  )
}

/**
 * Checks whether an incoming HTTP request is safe for mutation or sensitive dispatch.
 *
 * Requirements (Issue #113):
 * 1. Authorization header:
 *    - Bearer token accepted if matching server tokens or valid non-empty token when no static secret enforced.
 * 2. Sec-Fetch-Site header:
 *    - Must NOT be "cross-site" or "same-site" (fail-closed rejection).
 * 3. Origin / Referer:
 *    - If present, must not be "null" or empty.
 *    - Parsed Origin host must match Host or X-Forwarded-Host.
 * 4. Browser Same-Origin:
 *    - When Origin is present and matches Host / X-Forwarded-Host, request is permitted.
 * 5. Non-browser / header-only callers:
 *    - Sec-Fetch-Site alone without matching Origin is NOT auth.
 *    - Without Origin or Authorization, only local loopback (127.0.0.1, ::1) callers are permitted.
 */
export function isTrustedWriteRequest(req) {
  const headers = req.headers || {}
  const rawHost = headers.host || ''
  const forwardedHost = headers['x-forwarded-host'] || ''
  const effectiveHost = forwardedHost || rawHost

  // 1. Explicit Authorization header (Bridge / CLI / API token)
  const authHeader = headers.authorization
  const expectedToken = process.env.DSH_AUTH_TOKEN || process.env.DSH_TOKEN || process.env.ORCHESTRATOR_API_KEY
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim()
    if (token && (!expectedToken || token === expectedToken)) {
      return true
    }
  }

  // 2. Fetch Metadata check: reject cross-site and same-site requests upfront
  const site = headers['sec-fetch-site']
  if (site !== undefined && site) {
    if (site !== 'same-origin' && site !== 'none') {
      return false
    }
  }

  // 3. Origin check if present
  const origin = headers.origin
  if (origin !== undefined) {
    if (origin === 'null' || !origin) return false
    try {
      const parsed = new URL(origin)
      const originHost = parsed.host
      if (!originHost) return false
      if (originHost !== effectiveHost && originHost !== rawHost) {
        return false
      }
    } catch {
      return false
    }
  }

  // 4. Referer check if present
  const referer = headers.referer
  if (referer !== undefined && referer) {
    try {
      const parsed = new URL(referer)
      const refHost = parsed.host
      if (!refHost) return false
      if (refHost !== effectiveHost && refHost !== rawHost) {
        return false
      }
    } catch {
      return false
    }
  }

  // 5. If origin is present and matches effectiveHost/rawHost:
  if (origin && (effectiveHost || rawHost)) {
    try {
      const parsed = new URL(origin)
      if (parsed.host === effectiveHost || parsed.host === rawHost) {
        return true
      }
    } catch {
      return false
    }
  }

  // 6. If origin is absent, check for local loopback:
  // Fetch metadata alone (e.g. Sec-Fetch-Site: same-origin) is NOT authentication.
  // Header-only remote callers without Origin or Authorization are rejected.
  const ip = getClientIp(req)
  if (isLoopbackAddress(ip)) {
    // Local loopback caller without origin (CLI, server scripts) is allowed.
    return true
  }

  return false
}

export function rejectUntrustedRequest(req, res) {
  if (!isTrustedWriteRequest(req)) {
    try {
      res.statusCode = 403
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(
        JSON.stringify({
          ok: false,
          error: {
            code: 'forbidden',
            message: 'Forbidden: same-origin or local loopback only',
          },
        })
      )
    } catch {
      /* socket closed */
    }
    return true
  }
  return false
}

/**
 * Parses JSON request body with explicit payload size limit (Issue #113).
 * Throws an error if body exceeds maxBytes or is invalid JSON.
 *
 * @param {import('http').IncomingMessage} req
 * @param {number} [maxBytes=DEFAULT_MAX_BODY_BYTES]
 * @returns {Promise<object>}
 */
export function parseBoundedJsonBody(req, maxBytes = DEFAULT_MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let body = ''
    let receivedBytes = 0

    const onData = (chunk) => {
      receivedBytes += chunk.length
      if (receivedBytes > maxBytes) {
        req.pause()
        cleanup()
        const err = new Error(`Payload Too Large: body exceeds limit of ${maxBytes} bytes`)
        err.statusCode = 413
        reject(err)
        return
      }
      body += chunk
    }

    const onEnd = () => {
      cleanup()
      if (!body || body.trim() === '') {
        return resolve({})
      }
      try {
        const parsed = JSON.parse(body)
        resolve(parsed)
      } catch (e) {
        const err = new Error(`Invalid JSON body: ${e.message}`)
        err.statusCode = 400
        reject(err)
      }
    }

    const onError = (err) => {
      cleanup()
      reject(err)
    }

    function cleanup() {
      req.removeListener('data', onData)
      req.removeListener('end', onEnd)
      req.removeListener('error', onError)
    }

    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}
