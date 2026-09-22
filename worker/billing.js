// Stripe billing: hosted Checkout + Billing Portal, plus a webhook that flips
// the account's plan. Uses Stripe's REST API directly (no SDK, Workers-safe).
//
// Config (env): STRIPE_SECRET_KEY (secret), STRIPE_WEBHOOK_SECRET (secret),
// STRIPE_PRICE_MONTHLY / STRIPE_PRICE_YEARLY (price IDs).

import { json } from './auth.js'
import { hmacHex, safeEqual } from './crypto.js'

const STRIPE_API = 'https://api.stripe.com/v1'
const STRIPE_VERSION = '2024-06-20'
// Statuses that keep Pro access (past_due keeps access during the grace period).
const ACTIVE_STATUSES = ['active', 'trialing', 'past_due']

export function billingConfigured(env) {
  return !!(env.STRIPE_SECRET_KEY && (env.STRIPE_PRICE_MONTHLY || env.STRIPE_PRICE_YEARLY))
}

async function stripe(env, method, path, params) {
  const res = await fetch(`${STRIPE_API}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': STRIPE_VERSION,
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
  })
  let data = null
  try { data = await res.json() } catch (e) {}
  return { ok: res.ok, status: res.status, data: data || {} }
}

function baseUrl(request, env) {
  return (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, '')
}

export async function handleBilling(request, env, user, url) {
  const path = url.pathname
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: 'billing_unconfigured', message: 'Billing is not set up yet.' }, 400)
  }

  if (path === '/api/billing/checkout') {
    let body = {}
    try { body = await request.json() } catch (e) {}
    const interval = body.interval === 'year' ? 'year' : 'month'
    const price = interval === 'year' ? env.STRIPE_PRICE_YEARLY : env.STRIPE_PRICE_MONTHLY
    if (!price) return json({ error: 'billing_unconfigured', message: 'That plan is not available.' }, 400)

    let customerId = user.stripe_customer_id
    if (!customerId) {
      const c = await stripe(env, 'POST', 'customers', {
        email: user.email,
        name: user.name || '',
        'metadata[userId]': user.id,
      })
      if (!c.ok) return json({ error: 'stripe_error', message: (c.data.error && c.data.error.message) || 'Stripe error' }, 502)
      customerId = c.data.id
      await env.DB.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').bind(customerId, user.id).run()
    }

    const base = baseUrl(request, env)
    const s = await stripe(env, 'POST', 'checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      client_reference_id: user.id,
      'subscription_data[metadata][userId]': user.id,
      success_url: `${base}/?billing=success`,
      cancel_url: `${base}/?billing=cancel`,
      allow_promotion_codes: 'true',
    })
    if (!s.ok) return json({ error: 'stripe_error', message: (s.data.error && s.data.error.message) || 'Stripe error' }, 502)
    return json({ url: s.data.url })
  }

  if (path === '/api/billing/portal') {
    if (!user.stripe_customer_id) return json({ error: 'no_customer', message: 'No subscription to manage.' }, 400)
    const base = baseUrl(request, env)
    const p = await stripe(env, 'POST', 'billing_portal/sessions', {
      customer: user.stripe_customer_id,
      return_url: `${base}/`,
    })
    if (!p.ok) return json({ error: 'stripe_error', message: (p.data.error && p.data.error.message) || 'Stripe error' }, 502)
    return json({ url: p.data.url })
  }

  if (path === '/api/billing/refresh') {
    return json(await refreshUserSubscription(env, user))
  }

  return json({ error: 'Not found' }, 404)
}

// Pull the latest subscription from Stripe and update the user's plan.
export async function refreshUserSubscription(env, user) {
  if (!user.stripe_customer_id) {
    return { plan: user.plan || 'free', subscriptionStatus: user.subscription_status || null, planRenewsAt: user.plan_renews_at || null }
  }
  const subs = await stripe(env, 'GET', `subscriptions?customer=${encodeURIComponent(user.stripe_customer_id)}&status=all&limit=1`)
  const sub = subs.ok ? ((subs.data.data || [])[0] || null) : null
  if (!sub) {
    await setPlan(env, user.id, 'free', null, null, null)
    return { plan: 'free', subscriptionStatus: null, planRenewsAt: null }
  }
  const plan = ACTIVE_STATUSES.includes(sub.status) ? 'pro' : 'free'
  const renewsAt = sub.current_period_end ? sub.current_period_end * 1000 : null
  await setPlan(env, user.id, plan, sub.id, renewsAt, sub.status)
  return { plan, subscriptionStatus: sub.status, planRenewsAt: renewsAt }
}

async function setPlan(env, userId, plan, subscriptionId, renewsAt, status) {
  await env.DB.prepare(
    'UPDATE users SET plan = ?, stripe_subscription_id = ?, plan_renews_at = ?, subscription_status = ? WHERE id = ?'
  ).bind(plan, subscriptionId || null, renewsAt || null, status || null, userId).run()
}

// ---- webhook ---------------------------------------------------------------

export async function handleBillingWebhook(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const raw = await request.text()
  const ok = await verifyStripeSignature(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET)
  if (!ok) return json({ error: 'invalid_signature' }, 400)

  let event = null
  try { event = JSON.parse(raw) } catch (e) { return json({ error: 'bad_payload' }, 400) }
  const type = event.type
  const obj = event.data && event.data.object

  try {
    if (type === 'checkout.session.completed' && obj) {
      const userId = obj.client_reference_id || (obj.metadata && obj.metadata.userId)
      if (userId) {
        if (obj.customer) {
          await env.DB.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').bind(obj.customer, userId).run()
        }
        if (obj.subscription) await applySubscriptionById(env, userId, obj.customer, obj.subscription)
      }
    } else if (obj && (type === 'customer.subscription.created' || type === 'customer.subscription.updated' || type === 'customer.subscription.deleted')) {
      const user = await env.DB.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').bind(obj.customer).first()
      if (user) await applySubscriptionObject(env, user.id, obj.customer, obj)
    } else if (type === 'invoice.payment_failed' && obj) {
      const user = await env.DB.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').bind(obj.customer).first()
      if (user) await env.DB.prepare('UPDATE users SET subscription_status = ? WHERE id = ?').bind('past_due', user.id).run()
    }
  } catch (e) {
    console.error('stripe webhook handling failed', e && e.stack)
    return json({ error: 'handler_error' }, 500)
  }
  return json({ received: true })
}

async function applySubscriptionById(env, userId, customerId, subId) {
  const r = await stripe(env, 'GET', `subscriptions/${subId}`)
  if (!r.ok) return
  await applySubscriptionObject(env, userId, customerId, r.data)
}

async function applySubscriptionObject(env, userId, customerId, sub) {
  const plan = ACTIVE_STATUSES.includes(sub.status) ? 'pro' : 'free'
  const renewsAt = sub.current_period_end ? sub.current_period_end * 1000 : null
  await env.DB.prepare(
    'UPDATE users SET plan = ?, stripe_customer_id = ?, stripe_subscription_id = ?, subscription_status = ?, plan_renews_at = ? WHERE id = ?'
  ).bind(plan, customerId || null, sub.id || null, sub.status || null, renewsAt, userId).run()
}

// Verify a Stripe-Signature header ("t=<ts>,v1=<sig>,...").
export async function verifyStripeSignature(rawBody, header, secret) {
  if (!rawBody || !header || !secret) return false
  const parts = {}
  for (const kv of header.split(',')) {
    const i = kv.indexOf('=')
    if (i <= 0) continue
    const k = kv.slice(0, i).trim()
    const v = kv.slice(i + 1).trim()
    ;(parts[k] = parts[k] || []).push(v)
  }
  const t = parts.t && parts.t[0]
  const sigs = parts.v1 || []
  if (!t || !sigs.length) return false
  const ts = Number(t)
  if (!isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false
  const expected = await hmacHex(secret, `${t}.${rawBody}`)
  return sigs.some((s) => safeEqual(s, expected))
}
