// Board API: one JSON payload per account, stored in D1. On save we nudge the
// account's Durable Object so other open devices re-pull over WebSocket.

import { json, getSession } from './auth.js'

const MAX_PAYLOAD = 1_500_000 // ~1.5 MB; keep media out of the board JSON.

export async function getBoard(request, env, user) {
  const row = await env.DB
    .prepare('SELECT payload, updated_at FROM boards WHERE user_id = ?')
    .bind(user.id).first()
  if (!row) return json({ payload: null, updatedAt: 0 })
  return json({ payload: row.payload, updatedAt: row.updated_at })
}

export async function putBoard(request, env, user) {
  let body
  try { body = await request.json() } catch (e) { return json({ error: 'Invalid request' }, 400) }
  if (typeof body.payload !== 'string') return json({ error: 'Missing payload' }, 400)
  if (body.payload.length > MAX_PAYLOAD) {
    return json({ error: 'Board is too large to sync (move media to storage)' }, 413)
  }
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO boards (user_id, payload, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
  ).bind(user.id, body.payload, now).run()

  // Broadcast to this account's other connected devices.
  try {
    const stub = env.ROOM.get(env.ROOM.idFromName(user.id))
    await stub.fetch('https://room/notify', { method: 'POST' })
  } catch (e) { /* realtime is best-effort */ }

  return json({ ok: true, updatedAt: now })
}

export async function boardSocket(request, env, user) {
  const stub = env.ROOM.get(env.ROOM.idFromName(user.id))
  return stub.fetch(request)
}

export { getSession }
