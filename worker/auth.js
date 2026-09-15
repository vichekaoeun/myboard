// Session-cookie auth: passwordless magic link + Google OAuth. Stateless signed
// cookie (HMAC) so there is no session table to read on every request.

import { hmac, randomToken, sha256hex } from './crypto.js'
import { sendMagicLink } from './email.js'

const COOKIE = 'mb_session'
const OAUTH_STATE = 'mb_oauth_state'
const SESSION_MS = 30 * 24 * 60 * 60 * 1000
const MAGIC_MS = 15 * 60 * 1000

function isSecure(env) {
  return (env.PUBLIC_BASE_URL || '').startsWith('https://')
}

function cookie(name, value, maxAgeSec, env, httpOnly = true) {
  const parts = [`${name}=${value}`, 'Path=/', 'SameSite=Lax', `Max-Age=${maxAgeSec}`]
  if (httpOnly) parts.push('HttpOnly')
  if (isSecure(env)) parts.push('Secure')
  return parts.join('; ')
}

export function parseCookies(request) {
  const header = request.headers.get('Cookie') || ''
  const out = {}
  header.split(';').forEach((pair) => {
    const i = pair.indexOf('=')
    if (i > -1) out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim()
  })
  return out
}

async function sign(env, payload) {
  return `${payload}.${await hmac(env.SESSION_SECRET || 'dev-secret', payload)}`
}

export async function setSessionCookie(env, user) {
  const exp = Date.now() + SESSION_MS
  const token = await sign(env, `${user.id}.${exp}`)
  return cookie(COOKIE, token, Math.floor(SESSION_MS / 1000), env)
}

export function clearSessionCookie(env) {
  return cookie(COOKIE, '', 0, env)
}

export async function getSession(request, env) {
  const raw = parseCookies(request)[COOKIE]
  if (!raw) return null
  const lastDot = raw.lastIndexOf('.')
  if (lastDot < 0) return null
  const payload = raw.slice(0, lastDot)
  const sig = raw.slice(lastDot + 1)
  const expect = await hmac(env.SESSION_SECRET || 'dev-secret', payload)
  if (sig !== expect) return null
  const [uid, exp] = payload.split('.')
  if (!uid || !exp || Date.now() > Number(exp)) return null
  const row = await env.DB
    .prepare('SELECT id, email, name, picture FROM users WHERE id = ?')
    .bind(uid).first()
  return row || null
}

export async function upsertUser(env, { email, name, picture, provider }) {
  const mail = String(email || '').trim().toLowerCase()
  if (!mail) return null
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(mail).first()
  if (existing) {
    await env.DB.prepare('UPDATE users SET name = ?, picture = ? WHERE id = ?')
      .bind(name || '', picture || '', existing.id).run()
    return { id: existing.id, email: mail, name: name || '', picture: picture || '' }
  }
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO users (id, email, name, picture, provider, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, mail, name || '', picture || '', provider || 'email', Date.now()).run()
  return { id, email: mail, name: name || '', picture: picture || '' }
}

// ---- magic link ------------------------------------------------------------

export async function requestMagicLink(request, env) {
  let body
  try { body = await request.json() } catch (e) { return json({ error: 'Invalid request' }, 400) }
  const email = String(body.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email' }, 400)

  const token = randomToken()
  const tokenHash = await sha256hex(token)
  const now = Date.now()
  await env.DB.prepare(
    'INSERT INTO login_tokens (token_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).bind(tokenHash, email, now + MAGIC_MS, now).run()

  const base = env.PUBLIC_BASE_URL || new URL(request.url).origin
  const link = `${base}/api/auth/verify?token=${token}`

  const result = await sendMagicLink(env, email, link)
  const out = { ok: true }
  if (env.DEV_RETURN_LINK === 'true') out.devLink = link
  if (!result.ok && !env.DEV_RETURN_LINK) return json({ error: result.error || 'Could not send email' }, 502)
  return json(out)
}

export async function verifyMagicLink(request, env) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token') || ''
  const base = env.PUBLIC_BASE_URL || url.origin
  if (!token) return Response.redirect(`${base}/?auth=invalid`, 302)

  const tokenHash = await sha256hex(token)
  const row = await env.DB
    .prepare('SELECT email, expires_at FROM login_tokens WHERE token_hash = ?')
    .bind(tokenHash).first()
  await env.DB.prepare('DELETE FROM login_tokens WHERE token_hash = ?').bind(tokenHash).run()

  if (!row || Date.now() > row.expires_at) return Response.redirect(`${base}/?auth=expired`, 302)

  const user = await upsertUser(env, { email: row.email, provider: 'email' })
  const setCookie = await setSessionCookie(env, user)
  return new Response(null, {
    status: 302,
    headers: { Location: `${base}/`, 'Set-Cookie': setCookie },
  })
}

// ---- google oauth ----------------------------------------------------------

export function googleStart(request, env) {
  const url = new URL(request.url)
  const state = randomToken(16)
  const base = env.PUBLIC_BASE_URL || url.origin
  const redirectUri = `${base}/api/auth/google/callback`
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  })
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      'Set-Cookie': cookie(OAUTH_STATE, state, 600, env),
    },
  })
}

export async function googleCallback(request, env) {
  const url = new URL(request.url)
  const base = env.PUBLIC_BASE_URL || url.origin
  const code = url.searchParams.get('code') || ''
  const state = url.searchParams.get('state') || ''
  const expected = parseCookies(request)[OAUTH_STATE]
  const clearState = cookie(OAUTH_STATE, '', 0, env)

  if (!code || !state || state !== expected) {
    return new Response(null, { status: 302, headers: { Location: `${base}/?auth=invalid`, 'Set-Cookie': clearState } })
  }

  const redirectUri = `${base}/api/auth/google/callback`
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID || '',
      client_secret: env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => '')
    console.error('google token exchange failed', tokenRes.status, detail.slice(0, 300))
    return new Response(null, { status: 302, headers: { Location: `${base}/?auth=error`, 'Set-Cookie': clearState } })
  }
  const tokens = await tokenRes.json()
  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!infoRes.ok) {
    const detail = await infoRes.text().catch(() => '')
    console.error('google userinfo failed', infoRes.status, detail.slice(0, 300))
    return new Response(null, { status: 302, headers: { Location: `${base}/?auth=error`, 'Set-Cookie': clearState } })
  }
  const info = await infoRes.json()
  if (!info.email) {
    return new Response(null, { status: 302, headers: { Location: `${base}/?auth=error`, 'Set-Cookie': clearState } })
  }

  const user = await upsertUser(env, {
    email: info.email, name: info.name, picture: info.picture, provider: 'google',
  })
  const setCookie = await setSessionCookie(env, user)
  const headers = new Headers({ Location: `${base}/` })
  headers.append('Set-Cookie', clearState)
  headers.append('Set-Cookie', setCookie)
  return new Response(null, { status: 302, headers })
}

// ---- helpers ---------------------------------------------------------------

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
