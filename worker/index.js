// Worker entry: serves the built SPA from ./dist and the /api/* backend.

import {
  getSession, requestMagicLink, verifyMagicLink, googleStart, googleCallback,
  clearSessionCookie, json,
} from './auth.js'
import { handleBoard, boardSocket, accountSocket } from './board.js'
import { handleShare, shareSocket } from './share.js'
import { handleBilling, handleBillingWebhook, billingConfigured } from './billing.js'
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
      billing: billingConfigured(env),
      prices: {
        month: env.STRIPE_PRICE_MONTHLY ? true : false,
        year: env.STRIPE_PRICE_YEARLY ? true : false,
      },
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

  // Stripe webhook (public — verified by signature, not session).
  if (path === '/api/billing/webhook' && method === 'POST') return handleBillingWebhook(request, env)

  // Public shared-board endpoints — no account required, token only.
  if (path.startsWith('/api/share/')) {
    const seg = path.split('/').filter(Boolean) // ['api','share', token, ...]
    const token = seg[2] || null
    if (seg[3] === 'ws' && method === 'GET') return shareSocket(request, env, token)
    if (!seg[3]) return handleShare(request, env, url)
    return json({ error: 'Not found' }, 404)
  }

  if (path === '/api/me' && method === 'GET') {
    const user = await getSession(request, env)
    return json({
      user: user
        ? {
            id: user.id, email: user.email, name: user.name, picture: user.picture,
            plan: user.plan || 'free',
            subscriptionStatus: user.subscription_status || null,
            planRenewsAt: user.plan_renews_at || null,
          }
        : null,
    })
  }

  // Everything below requires a signed-in session.
  const user = await getSession(request, env)
  if (!user) return json({ error: 'Not signed in' }, 401)

  // Board-scoped realtime socket: presence + change pings for one board.
  if (path.startsWith('/api/boards/') && path.endsWith('/ws') && method === 'GET') {
    const seg = path.split('/').filter(Boolean) // ['api','boards', id, 'ws']
    return boardSocket(request, env, user, seg[2])
  }
  if ((path === '/api/boards' || path.startsWith('/api/boards/')) && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return handleBoard(request, env, user, url)
  }
  if (path === '/api/link-preview' && method === 'GET') return handleLinkPreview(request, env, ctx)
  if (path.startsWith('/api/billing/') && method === 'POST') return handleBilling(request, env, user, url)
  if (path === '/api/ws' && method === 'GET') return accountSocket(request, env, user)

  return json({ error: 'Not found' }, 404)
}
