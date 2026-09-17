// Worker entry: serves the built SPA from ./dist and the /api/* backend.

import {
  getSession, requestMagicLink, verifyMagicLink, googleStart, googleCallback,
  clearSessionCookie, json,
} from './auth.js'
import { getBoard, putBoard, boardSocket } from './board.js'
import { handleLinkPreview } from './preview.js'

export { Room } from './room.js'

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      try {
        return await route(request, env, url, ctx)
      } catch (err) {
        console.error('api error', err && err.stack)
        return json({ error: 'Server error' }, 500)
      }
    }
    // Static assets (SPA fallback handled by not_found_handling).
    return env.ASSETS.fetch(request)
  },
}

async function route(request, env, url, ctx) {
  const path = url.pathname
  const method = request.method

  if (path === '/api/health') return json({ ok: true })

  if (path === '/api/config' && method === 'GET') {
    return json({
      google: !!env.GOOGLE_CLIENT_ID,
      email: !!(env.RESEND_API_KEY || env.DEV_RETURN_LINK === 'true'),
    })
  }

  if (path === '/api/auth/email' && method === 'POST') return requestMagicLink(request, env)
  if (path === '/api/auth/verify' && method === 'GET') return verifyMagicLink(request, env)
  if (path === '/api/auth/google' && method === 'GET') return googleStart(request, env)
  if (path === '/api/auth/google/callback' && method === 'GET') return googleCallback(request, env)
  if (path === '/api/auth/logout' && method === 'POST') {
    const res = json({ ok: true })
    res.headers.append('Set-Cookie', clearSessionCookie(env))
    return res
  }

  if (path === '/api/me' && method === 'GET') {
    const user = await getSession(request, env)
    return json({
      user: user ? { id: user.id, email: user.email, name: user.name, picture: user.picture } : null,
    })
  }

  // Everything below requires a signed-in session.
  const user = await getSession(request, env)
  if (!user) return json({ error: 'Not signed in' }, 401)

  if (path === '/api/board' && method === 'GET') return getBoard(request, env, user)
  if (path === '/api/board' && method === 'PUT') return putBoard(request, env, user)
  if (path === '/api/link-preview' && method === 'GET') return handleLinkPreview(request, env, ctx)
  if (path === '/api/ws' && method === 'GET') return boardSocket(request, env, user)

  return json({ error: 'Not found' }, 404)
}
