// Board API: many boards per account. Every board is a JSON payload row owned
// by a user; access is always scoped to the signed-in user.

import { json } from './auth.js'
import { randomToken } from './crypto.js'

const MAX_PAYLOAD = 1_500_000 // ~1.5 MB; keep media out of the board JSON.

// Live-update rooms are Durable Objects. Each account has a room (keyed by the
// user id); each shared board also has one so guests and the owner stay in sync.
export function boardRoomName(id) {
  return 'board:' + id
}

export async function notifyRoom(env, name) {
  try {
    const stub = env.ROOM.get(env.ROOM.idFromName(name))
    await stub.fetch('https://room/notify', { method: 'POST' })
  } catch (e) { /* realtime is best-effort */ }
}

// Entitlements. Free accounts get a small number of boards; Pro is unlimited
// in practice. Enforced server-side so it can't be bypassed from the client.
const PLAN_BOARD_LIMIT = { free: 2, pro: 500 }
function boardLimit(plan) {
  return PLAN_BOARD_LIMIT[plan] || PLAN_BOARD_LIMIT.free
}

function emptyPayload() {
  return JSON.stringify({
    notes: [], pins: [], clips: [], music: [], cards: [], envelopes: [], links: [],
    view: { x: 0, y: 0, s: 1 },
  })
}

// Human-friendly slug for deep links: "My Board" -> "my-board-3f9a2c". The short
// id suffix keeps it unique and stable across renames.
function slugify(name) {
  const base = String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return base || 'board'
}

function boardSlug(name, id) {
  return `${slugify(name)}-${id.slice(0, 6)}`
}

export async function handleBoard(request, env, user, url) {
  const method = request.method
  const parts = url.pathname.split('/').filter(Boolean) // ['api','boards', id?, 'share'?]
  const id = parts[2] || null

  if (!id) {
    if (method === 'GET') return listBoards(env, user)
    if (method === 'POST') return createBoard(request, env, user)
    return json({ error: 'Method not allowed' }, 405)
  }

  // /api/boards/:id/share — manage the public link for one board.
  if (parts[3] === 'share') return manageShare(request, env, user, id, method)

  const row = await env.DB
    .prepare('SELECT id, user_id, name, payload, updated_at, share_token, share_mode, slug FROM boards WHERE id = ? AND user_id = ?')
    .bind(id, user.id).first()
  if (!row) return json({ error: 'Not found' }, 404)

  if (method === 'GET') {
    return json({
      id: row.id, name: row.name, payload: row.payload, updatedAt: row.updated_at,
      shareToken: row.share_token || null, shareMode: row.share_mode || 'view',
      slug: row.slug || row.id,
    })
  }
  if (method === 'PUT') return saveBoard(request, env, user, row)
  if (method === 'PATCH') return renameBoard(request, env, user, row)
  if (method === 'DELETE') return deleteBoard(env, user, row)
  return json({ error: 'Method not allowed' }, 405)
}

async function listBoards(env, user) {
  const { results } = await env.DB
    .prepare('SELECT id, name, updated_at, share_token, share_mode, slug FROM boards WHERE user_id = ? ORDER BY updated_at ASC')
    .bind(user.id).all()
  const rows = results || []
  // Lazily backfill slugs for boards created before slugs existed.
  for (const r of rows) {
    if (!r.slug) {
      r.slug = boardSlug(r.name, r.id)
      try {
        await env.DB.prepare('UPDATE boards SET slug = ? WHERE id = ? AND user_id = ?').bind(r.slug, r.id, user.id).run()
      } catch (e) { /* best effort */ }
    }
  }
  return json({
    boards: rows.map((r) => ({
      id: r.id, name: r.name, updatedAt: r.updated_at > 0 ? r.updated_at : 0,
      shareToken: r.share_token || null, shareMode: r.share_mode || 'view',
      slug: r.slug,
    })),
  })
}

// Create, update (mode) or revoke a board's share link.
async function manageShare(request, env, user, id, method) {
  const row = await env.DB
    .prepare('SELECT id, share_token, share_mode FROM boards WHERE id = ? AND user_id = ?')
    .bind(id, user.id).first()
  if (!row) return json({ error: 'Not found' }, 404)

  if (method === 'DELETE') {
    await env.DB.prepare('UPDATE boards SET share_token = NULL WHERE id = ? AND user_id = ?').bind(id, user.id).run()
    // Wake anyone viewing the link so they re-check and see it's gone.
    await notifyRoom(env, boardRoomName(id))
    await notifyRoom(env, user.id)
    return json({ ok: true, shareToken: null, shareMode: row.share_mode || 'view' })
  }
  if (method === 'POST' || method === 'PATCH') {
    let body = {}
    try { body = await request.json() } catch (e) {}
    const mode = body.mode === 'edit' ? 'edit' : 'view'
    const token = row.share_token || randomToken(18)
    await env.DB
      .prepare('UPDATE boards SET share_token = ?, share_mode = ? WHERE id = ? AND user_id = ?')
      .bind(token, mode, id, user.id).run()
    // Wake viewers so a newly created/updated link is picked up.
    await notifyRoom(env, boardRoomName(id))
    return json({ ok: true, shareToken: token, shareMode: mode })
  }
  return json({ error: 'Method not allowed' }, 405)
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
  const slug = boardSlug(name, id)
  await env.DB
    .prepare('INSERT INTO boards (id, user_id, name, payload, updated_at, slug) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, user.id, name, emptyPayload(), now, slug).run()
  return json({ id, name, updatedAt: now, slug })
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
  // Broadcast to this account's other devices, and to everyone (owner or
  // guests) currently viewing this board, so they re-pull and update presence.
  await notifyRoom(env, boardRoomName(row.id))
  await notifyRoom(env, user.id)
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

// Live socket for the board the owner is editing (board-scoped, so presence is
// per-board and the owner sees guests on a shared board).
export async function boardSocket(request, env, user, boardId) {
  if (!boardId) return new Response('Not found', { status: 404 })
  const row = await env.DB
    .prepare('SELECT id FROM boards WHERE id = ? AND user_id = ?')
    .bind(boardId, user.id).first()
  if (!row) return new Response('Not found', { status: 404 })
  const stub = env.ROOM.get(env.ROOM.idFromName(boardRoomName(boardId)))
  return stub.fetch(request)
}

// Account-scoped socket (kept for compatibility; clients now use board sockets).
export async function accountSocket(request, env, user) {
  const stub = env.ROOM.get(env.ROOM.idFromName(user.id))
  return stub.fetch(request)
}