import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'

export const ACCESS_TTL_SECONDS = 15 * 60
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60
export const REFRESH_COOKIE = 'twopoles_refresh'

const b64url = (value) => Buffer.from(value).toString('base64url')

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function hashIdentifier(identifier, secret) {
  return createHmac('sha256', secret).update(identifier).digest('hex')
}

export function normalizeIdentifier(raw) {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || value.length > 120) return null
  if (value.includes('@')) {
    const email = value.toLowerCase()
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
  }
  const phone = value.replace(/[\s-]/g, '')
  return /^\+?\d{6,15}$/.test(phone) ? phone : null
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt$${salt}$${hash}`
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false
  const [kind, salt, hash] = stored.split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const actual = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function signAccessToken(userId, secret, ttl = ACCESS_TTL_SECONDS) {
  const payload = b64url(JSON.stringify({
    sub: userId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttl
  }))
  return `${payload}.${sign(payload, secret)}`
}

export function verifyAccessToken(token, secret) {
  if (typeof token !== 'string') return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  const expected = sign(payload, secret)
  if (signature.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof data.sub !== 'string') return null
    if (typeof data.exp !== 'number' || data.exp * 1000 <= Date.now()) return null
    return data.sub
  } catch {
    return null
  }
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export function createRefreshToken(db, userId) {
  const token = randomBytes(32).toString('hex')
  const now = new Date()
  const expires = new Date(now.getTime() + REFRESH_TTL_SECONDS * 1000)
  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomUUID(), userId, hashToken(token), expires.toISOString(), now.toISOString())
  return token
}

export function rotateRefreshToken(db, rawToken) {
  if (typeof rawToken !== 'string' || !rawToken) return null
  const now = new Date().toISOString()
  const row = db.prepare(`
    SELECT * FROM refresh_tokens
    WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
  `).get(hashToken(rawToken), now)
  if (!row) return null
  db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?').run(now, row.id)
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(row.user_id)
  if (!user) return null
  return { user, refreshToken: createRefreshToken(db, user.id) }
}

export function revokeRefreshToken(db, rawToken) {
  if (typeof rawToken !== 'string' || !rawToken) return
  db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .run(new Date().toISOString(), hashToken(rawToken))
}

export function parseCookies(req) {
  const header = req.headers.cookie
  if (!header) return {}
  const out = {}
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key) out[key] = decodeURIComponent(value)
  }
  return out
}

export function refreshCookie(token, secure) {
  const parts = [
    `${REFRESH_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/api/v1/auth',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${REFRESH_TTL_SECONDS}`
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function clearRefreshCookie(secure) {
  const parts = [
    `${REFRESH_COOKIE}=`,
    'Path=/api/v1/auth',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function accessTokenFromRequest(req) {
  const header = req.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null
  return header.slice(7).trim()
}

export function userFromRequest(req, db, secret) {
  const token = accessTokenFromRequest(req)
  if (!token) return null
  const userId = verifyAccessToken(token, secret)
  if (!userId) return null
  return db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(userId) ?? null
}

export function userJson(row) {
  return { id: row.id, type: row.type, createdAt: row.created_at }
}
