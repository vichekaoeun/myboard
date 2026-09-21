// Public shared-board API. A board may expose a secret link token; anyone with
// the link can read it (and, when the owner allows it, edit it) without an
// account. All access is by unguessable token only.

import { json } from './auth.js'
import { boardRoomName, notifyRoom } from './board.js'

const MAX_PAYLOAD = 1_500_000 // ~1.5 MB, same ceiling as the owner API.

async function loadShared(env, token) {
  if (!token) return null
  return env.DB
    .prepare('SELECT id, user_id, name, payload, updated_at, share_mode FROM boards WHERE share_token = ?')
    .bind(token).first()
}

export async function handleShare(request, env, url) {
  const method = request.method
  const parts = url.pathname.split('/').filter(Boolean) // ['api','share', token, 'ws'?]
  const token = parts[2] || null
  const row = await loadShared(env, token)
  if (!row) return json({ error: 'not_found', message: 'This shared board is no longer available.' }, 404)

  if (method === 'GET') {
    return json({
      id: row.id, name: row.name, mode: row.share_mode || 'view',
      payload: row.payload, updatedAt: row.updated_at,
    })
  }

  if (method === 'PUT') {
    if ((row.share_mode || 'view') !== 'edit') {
      return json({ error: 'view_only', message: 'This board is view-only.' }, 403)
    }
    let body
    try { body = await request.json() } catch (e) { return json({ error: 'Invalid request' }, 400) }
    if (typeof body.payload !== 'string') return json({ error: 'Missing payload' }, 400)
    if (body.payload.length > MAX_PAYLOAD) {
      return json({ error: 'too_large', message: 'Board is too large to sync' }, 413)
    }
    const now = Date.now()
    await env.DB
      .prepare('UPDATE boards SET payload = ?, updated_at = ? WHERE id = ?')
      .bind(body.payload, now, row.id).run()
    // Wake the board room (guests) and the owner's devices.
    await notifyRoom(env, boardRoomName(row.id))
    await notifyRoom(env, row.user_id)
    return json({ ok: true, updatedAt: now })
  }

  return json({ error: 'Method not allowed' }, 405)
}

export async function shareSocket(request, env, token) {
  const row = await loadShared(env, token)
  if (!row) return new Response('Not found', { status: 404 })
  const stub = env.ROOM.get(env.ROOM.idFromName(boardRoomName(row.id)))
  return stub.fetch(request)
}