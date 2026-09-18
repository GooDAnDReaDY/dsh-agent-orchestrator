/**
 * HTTP guard utilities for protecting write endpoints (POST/PUT/DELETE)
 * against drive-by CSRF, unauthorized cross-network access, and cross-origin tampering.
 *
 * Implements Issue #113:
 * 1. Loopback / Origin / Host validation
 * 2. Sec-Fetch-Site and Referer verification
 * 3. Body size limiter (default 1MB) with fail-closed rejection
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
 * Requirements:
 * 1. If Origin header is present:
 *    - must not be "null" or empty
 *    - parsed Origin host must match Host header
 * 2. If Referer header is present:
 *    - parsed Referer host must match Host header
 * 3. If Sec-Fetch-Site header is present:
 *    - must be "same-origin" or "none" (cross-site and same-site are rejected)
 * 4. If neither Origin nor Sec-Fetch-Site is present:
 *    - only local loopback clients (127.0.0.1, ::1) are permitted.
 */
export function isTrustedWriteRequest(req) {
  const headers = req.headers || {}
  const host = headers.host || ''

  const origin = headers.origin
  if (origin !== undefined) {
    if (origin === 'null' || !origin) return false
    try {
      const parsed = new URL(origin)
      if (parsed.host && host && parsed.host !== host) return false
    } catch {
      return false
    }
  }

  const referer = headers.referer
  if (referer !== undefined && referer) {
    try {
      const parsed = new URL(referer)
      if (parsed.host && host && parsed.host !== host) return false
    } catch {
      return false
    }
  }

  const site = headers['sec-fetch-site']
  if (site !== undefined && site) {
    if (site !== 'same-origin' && site !== 'none') return false
  }

  // If both origin and sec-fetch-site are absent, permit only loopback callers
  if (origin === undefined && site === undefined) {
    const ip = getClientIp(req)
    if (!isLoopbackAddress(ip)) {
      return false
    }
  }

  return true
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
