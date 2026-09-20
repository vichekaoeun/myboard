// Board API: many boards per account. Every board is a JSON payload row owned
// by a user; access is always scoped to the signed-in user.

import { json } from './auth.js'

const MAX_PAYLOAD = 1_500_000 // ~1.5 MB; keep media out of the board JSON.

// Entitlements. Free accounts get a small number of boards; Pro is unlimited
// in practice. Enforced server-side so it can't be bypassed from the client.
const PLAN_BOARD_LIMIT = { free: 3, pro: 500 }
function boardLimit(plan) {
  return PLAN_BOARD_LIMIT[plan] || PLAN_BOARD_LIMIT.free
}

function emptyPayload() {
  return JSON.stringify({
    notes: [], pins: [], clips: [], music: [], cards: [], envelopes: [], links: [],
    view: { x: 0, y: 0, s: 1 },
  })
}

export async function handleBoard(request, env, user, url) {
  const method = request.method
  const parts = url.pathname.split('/').filter(Boolean) // ['api','boards', id?]
  const id = parts[2] || null

  if (!id) {
    if (method === 'GET') return listBoards(env, user)
    if (method === 'POST') return createBoard(request, env, user)
    return json({ error: 'Method not allowed' }, 405)
  }

  const row = await env.DB
    .prepare('SELECT id, user_id, name, payload, updated_at FROM boards WHERE id = ? AND user_id = ?')
    .bind(id, user.id).first()
  if (!row) return json({ error: 'Not found' }, 404)

  if (method === 'GET') return json({ id: row.id, name: row.name, payload: row.payload, updatedAt: row.updated_at })
  if (method === 'PUT') return saveBoard(request, env, user, row)
  if (method === 'PATCH') return renameBoard(request, env, user, row)
  if (method === 'DELETE') return deleteBoard(env, user, row)
  return json({ error: 'Method not allowed' }, 405)
}

async function listBoards(env, user) {
  const { results } = await env.DB
    .prepare('SELECT id, name, updated_at FROM boards WHERE user_id = ? ORDER BY updated_at ASC')
    .bind(user.id).all()
  return json({
    boards: (results || []).map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at })),
  })
}

async function createBoard(request, env, user) {
  let body = {}
  try { body = await request.json() } catch (e) {}
  const name = String(body.name || 'New board').trim().slice(0, 80) || 'New board'
  const count = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM boards WHERE user_id = ?')
    .bind(user.id).first()
  const limit = boardLimit(user.plan)
  if ((count && count.n) >= limit) {
    return json({
      error: 'board_limit',
      message: `Your Free plan includes ${limit} boards. Upgrade to Pro for unlimited boards.`,
      limit,
      plan: user.plan || 'free',
    }, 402)
  }
  const id = crypto.randomUUID()
  const now = Date.now()
  await env.DB
    .prepare('INSERT INTO boards (id, user_id, name, payload, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, user.id, name, emptyPayload(), now).run()
  return json({ id, name, updatedAt: now })
}

async function saveBoard(request, env, user, row) {
  let body
  try { body = await request.json() } catch (e) { return json({ error: 'Invalid request' }, 400) }
  if (typeof body.payload !== 'string') return json({ error: 'Missing payload' }, 400)
  if (body.payload.length > MAX_PAYLOAD) {
    return json({ error: 'Board is too large to sync (move media to storage)' }, 413)
  }
  const now = Date.now()
  await env.DB
    .prepare('UPDATE boards SET payload = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .bind(body.payload, now, row.id, user.id).run()
  // Broadcast to this account's other connected devices.
  try {
    const stub = env.ROOM.get(env.ROOM.idFromName(user.id))
    await stub.fetch('https://room/notify', { method: 'POST' })
  } catch (e) { /* realtime is best-effort */ }
  return json({ ok: true, updatedAt: now })
}

async function renameBoard(request, env, user, row) {
  let body
  try { body = await request.json() } catch (e) { return json({ error: 'Invalid request' }, 400) }
  const name = String(body.name || '').trim().slice(0, 80) || row.name
  await env.DB
    .prepare('UPDATE boards SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .bind(name, Date.now(), row.id, user.id).run()
  return json({ ok: true, name })
}

async function deleteBoard(env, user, row) {
  await env.DB.prepare('DELETE FROM boards WHERE id = ? AND user_id = ?').bind(row.id, user.id).run()
  return json({ ok: true })
}

export async function boardSocket(request, env, user) {
  const stub = env.ROOM.get(env.ROOM.idFromName(user.id))
  return stub.fetch(request)
}
