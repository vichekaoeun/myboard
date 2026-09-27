// Chart automation: poll a data source (public Google Sheet, or any CSV/JSON
// URL) and refresh the chart's data on a schedule.
//
// Google Sheets are read through the public CSV export endpoint, so no Google
// account or OAuth scope is needed — the sheet just has to be shared as
// "Anyone with the link: Viewer". (A connected Google account is supported as
// a fallback for sheets that aren't public.)

import { unseal, randomToken } from './crypto.js'
import { json } from './auth.js'

const MAX_SOURCE_BYTES = 1_000_000
const MIN_INTERVAL = 5 * 60 * 1000

function jsonPath(value, path) {
  if (!path) return value
  return String(path).split('.').filter(Boolean).reduce((current, key) => {
    if (current == null) return undefined
    return current[key]
  }, value)
}

// Parse CSV/TSV into a grid of trimmed cells (handles quotes).
function parseDelimited(text, delimiter) {
  const rows = []
  let row = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++ }
      else quoted = !quoted
    } else if (ch === delimiter && !quoted) {
      row.push(cell.trim()); cell = ''
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell.trim()); cell = ''
      if (row.some((v) => v !== '')) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell.trim())
  if (row.some((v) => v !== '')) rows.push(row)
  return rows
}

function parseCsv(text) {
  const rows = parseDelimited(text, text.indexOf('\t') >= 0 && text.indexOf(',') < 0 ? '\t' : ',')
  if (rows.length < 2) return []
  const headers = rows[0].map((v) => v.toLowerCase())
  const labelIndex = headers.indexOf('label') >= 0 ? headers.indexOf('label') : 0
  const valueIndex = headers.indexOf('value') >= 0 ? headers.indexOf('value') : 1
  return rows.slice(1).map((r) => ({ label: r[labelIndex], value: Number(r[valueIndex]) }))
}

function sheetId(value) {
  const match = String(value || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : String(value || '').trim()
}

function sheetNameFromRange(range) {
  const r = String(range || '').trim()
  const bang = r.indexOf('!')
  return bang > 0 ? r.slice(0, bang).replace(/^'|'$/g, '') : ''
}

function columnIndex(value) {
  const s = String(value || '').trim().toUpperCase()
  if (/^\d+$/.test(s)) return Math.max(0, Number(s) - 1)
  let out = 0
  for (const ch of s) out = out * 26 + ch.charCodeAt(0) - 64
  return Math.max(0, out - 1)
}

// A chart automation is runnable (polled) when it's enabled and has a pull source.
export function automationHasSource(a) {
  if (!a || !a.enabled) return false
  if (a.kind === 'push') return false // push sources receive data, they aren't polled
  return a.kind === 'google-sheets' ? !!(a.spreadsheetUrl || a.spreadsheetId) : !!a.url
}

// ---- Google Sheets (public CSV, no OAuth) ----------------------------------

function gidFromUrl(value) {
  const m = String(value || '').match(/[#&?]gid=(\d+)/)
  return m ? m[1] : ''
}

function pointsFromGrid(rows, label, value) {
  if (!rows.length) return []
  // Treat the first row as a header only when its value cell isn't a number.
  const header = !Number.isFinite(Number(rows[0][value]))
  const body = header ? rows.slice(1) : rows
  return body
    .map((r) => ({ label: r[label], value: Number(r[value]) }))
    .filter((r) => r.label != null && r.label !== '' && Number.isFinite(r.value))
}

async function readSheetPublic(automation) {
  const raw = automation.spreadsheetUrl || automation.spreadsheetId
  const id = sheetId(raw)
  if (!id) throw new Error('Enter a Google Sheets URL')
  const label = columnIndex(automation.labelColumn || 'A')
  const value = columnIndex(automation.valueColumn || 'B')
  const gid = gidFromUrl(raw)
  const sheet = sheetNameFromRange(automation.range)

  const build = (query) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/gviz/tq?tqx=out:csv${query}`
  const attempts = []
  if (gid) attempts.push(`&gid=${gid}`)
  if (sheet && !gid) {
    attempts.push(`&sheet=${encodeURIComponent(sheet)}`)
    attempts.push('') // fall back to the first sheet if the tab name is wrong
  }
  if (!attempts.length) attempts.push('')

  let lastErr = null
  for (const query of attempts) {
    const res = await fetch(build(query), { signal: AbortSignal.timeout(15_000) })
    const text = await res.text()
    if (/^\s*<!doctype html/i.test(text) || /<html/i.test(text.slice(0, 300))) {
      lastErr = new Error('Sheet is not public — set Share → “Anyone with the link: Viewer”')
      continue
    }
    if (!res.ok) { lastErr = new Error(`Google returned HTTP ${res.status}`); continue }
    if (text.length > MAX_SOURCE_BYTES) throw new Error('Sheet is too large')
    const points = pointsFromGrid(parseDelimited(text, ','), label, value)
    if (points.length) return points
  }
  if (lastErr) throw lastErr
  return []
}

async function googleAccessToken(env, userId) {
  const row = await env.DB.prepare('SELECT google_refresh_token FROM users WHERE id = ?').bind(userId).first()
  const refresh = await unseal(env.SESSION_SECRET, row && row.google_refresh_token)
  if (!refresh) throw new Error('Connect Google to read a private sheet')
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID || '', client_secret: env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: refresh, grant_type: 'refresh_token',
    }),
  })
  if (!response.ok) throw new Error('Could not refresh Google access')
  const data = await response.json()
  if (!data.access_token) throw new Error('Google did not return an access token')
  return data.access_token
}

async function readSheetOAuth(env, userId, automation) {
  const id = sheetId(automation.spreadsheetUrl || automation.spreadsheetId)
  const range = automation.range || 'Sheet1!A:B'
  const token = await googleAccessToken(env, userId)
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const body = await response.text()
  if (!response.ok) {
    let detail = ''
    try { detail = JSON.parse(body).error?.message || '' } catch (e) {}
    throw new Error(detail || `Google Sheets returned HTTP ${response.status}`)
  }
  const values = JSON.parse(body).values || []
  if (values.length < 2) return []
  const label = columnIndex(automation.labelColumn || 'A')
  const value = columnIndex(automation.valueColumn || 'B')
  return values.slice(1)
    .map((r) => ({ label: r[label], value: Number(r[value]) }))
    .filter((r) => r.label != null && r.label !== '' && Number.isFinite(r.value))
}

// Try the public CSV first (no account needed); fall back to OAuth only when a
// Google account is actually connected. Errors aim to be actionable.
async function readSheet(env, userId, automation) {
  let rows = []
  let publicErr = null
  try {
    rows = await readSheetPublic(automation)
  } catch (err) {
    publicErr = err
  }
  if (rows.length) return rows

  let oauthErr = null
  try {
    return await readSheetOAuth(env, userId, automation)
  } catch (err) {
    oauthErr = err
  }
  const noAccount = /Connect Google/i.test(String((oauthErr && oauthErr.message) || ''))
  if (!noAccount && oauthErr) throw oauthErr
  if (publicErr) throw publicErr
  throw new Error('No numeric rows found — check the range and the label/value columns')
}


// ---- generic CSV/JSON sources ----------------------------------------------

async function readSource(automation) {
  const url = new URL(String(automation.url || ''))
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS sources are supported')
  const host = url.hostname.toLowerCase()
  if (['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1'].includes(host) || host.endsWith('.local')) {
    throw new Error('Private sources are not supported')
  }
  const response = await fetch(url.href, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`)
  const length = Number(response.headers.get('content-length') || 0)
  if (length > MAX_SOURCE_BYTES) throw new Error('Source is too large')
  const text = await response.text()
  if (text.length > MAX_SOURCE_BYTES) throw new Error('Source is too large')
  return { text, contentType: response.headers.get('content-type') || '' }
}

function rowsFromSource(source, automation) {
  const format = automation.format || (source.contentType.includes('json') ? 'json' : 'csv')
  if (format === 'csv') return parseCsv(source.text)
  let parsed
  try { parsed = JSON.parse(source.text) } catch (e) { throw new Error('Source is not valid JSON') }
  const list = jsonPath(parsed, automation.rowsPath || '')
  if (!Array.isArray(list)) throw new Error('JSON rows path must point to an array')
  return list.map((item, index) => ({
    label: jsonPath(item, automation.labelPath || 'label') ?? index + 1,
    value: Number(jsonPath(item, automation.valuePath || 'value')),
  }))
}

async function fetchRows(env, userId, automation) {
  const data = automation.kind === 'google-sheets'
    ? await readSheet(env, userId, automation)
    : rowsFromSource(await readSource(automation), automation)
  const clean = (data || []).filter((row) => row && row.label != null && row.label !== '' && Number.isFinite(row.value)).slice(0, 500)
  if (!clean.length) throw new Error('Source produced no valid rows')
  return clean
}

// Used by the scheduled job.
export async function pollChart(chart, env, userId) {
  const automation = chart && chart.automation
  if (!automationHasSource(automation)) return null
  return fetchRows(env, userId, automation)
}

// Used by the "Fetch now" button so people can test without waiting for the cron.
export async function previewAutomation(env, userId, automation) {
  const a = { ...automation, enabled: true }
  if (!automationHasSource(a)) throw new Error('Add a source URL first')
  return fetchRows(env, userId, a)
}

export function nextAutomationRun(automation, now = Date.now()) {
  const interval = Math.max(MIN_INTERVAL, Number(automation.intervalMs) || MIN_INTERVAL)
  return now + interval
}

export async function runAutomations(env) {
  const rows = await env.DB.prepare('SELECT id, user_id, payload FROM boards').all()
  for (const row of rows.results || []) {
    let payload
    try { payload = JSON.parse(row.payload) } catch (e) { continue }
    const charts = Array.isArray(payload.charts) ? payload.charts : []
    let changed = false
    for (const chart of charts) {
      const automation = chart.automation
      if (!automationHasSource(automation)) continue
      const now = Date.now()
      if (automation.nextRunAt && automation.nextRunAt > now) continue
      try {
        chart.data = await fetchRows(env, row.user_id, automation)
        chart.automation = { ...automation, lastRunAt: now, nextRunAt: nextAutomationRun(automation, now), lastError: '' }
      } catch (error) {
        chart.automation = { ...automation, lastRunAt: now, nextRunAt: nextAutomationRun(automation, now), lastError: String((error && error.message) || 'Polling failed').slice(0, 240) }
      }
      changed = true
    }
    if (!changed) continue
    await env.DB.prepare('UPDATE boards SET payload = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(payload), Date.now(), row.id).run()
    try {
      const stub = env.ROOM.get(env.ROOM.idFromName('board:' + row.id))
      await stub.fetch('https://room/notify', { method: 'POST' })
    } catch (e) { /* realtime notification is best-effort */ }
  }
}

// ---- push / webhook source -------------------------------------------------
//
// External systems POST chart data to /api/hooks/<token>. We accept a JSON
// array of {label,value}, an array of [label,value], an object map, or CSV.

export function normalizePoints(raw, contentType = '') {
  const text = String(raw || '').trim()
  if (!text) throw new Error('Empty payload')
  // Detect JSON by its first character, so CSV works regardless of content-type.
  const asJson = text[0] === '[' || text[0] === '{'
  if (!asJson) {
    return text.split(/\r?\n/).map((line) => {
      const parts = line.split(/[,\t;]+/)
      if (parts.length < 2) return null
      const value = Number(parts[parts.length - 1])
      const label = parts.slice(0, -1).join(' ').trim()
      return Number.isFinite(value) && label ? { label, value } : null
    }).filter(Boolean).slice(0, 500)
  }
  let parsed
  try { parsed = JSON.parse(text) } catch (e) { throw new Error('Invalid JSON') }
  if (Array.isArray(parsed)) {
    return parsed.map((item) => {
      if (Array.isArray(item)) return { label: item[0], value: Number(item[1]) }
      if (item && typeof item === 'object') {
        return { label: item.label ?? item.name ?? item.key, value: Number(item.value ?? item.count) }
      }
      return null
    }).filter((p) => p && p.label != null && p.label !== '' && Number.isFinite(p.value)).slice(0, 500)
  }
  if (parsed && typeof parsed === 'object') {
    return Object.entries(parsed)
      .map(([label, value]) => ({ label, value: Number(value) }))
      .filter((p) => Number.isFinite(p.value)).slice(0, 500)
  }
  throw new Error('Unsupported payload — send a JSON array of {label,value}, or CSV')
}

const HOOK_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Public endpoint: receives a data push for one chart.
export async function handleHook(request, env, url) {
  const reply = (status, body) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', ...HOOK_CORS },
  })
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HOOK_CORS })
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' })

  const token = url.pathname.split('/').filter(Boolean)[2]
  const hook = await env.DB.prepare('SELECT token, board_id, chart_id FROM chart_hooks WHERE token = ?').bind(token).first()
  if (!hook) return reply(404, { error: 'invalid_hook' })

  const raw = await request.text()
  if (raw.length > 200_000) return reply(413, { error: 'too_large' })
  let data
  try { data = normalizePoints(raw, request.headers.get('content-type') || '') } catch (e) {
    return reply(400, { error: String((e && e.message) || 'Bad payload') })
  }
  if (!data.length) return reply(400, { error: 'No valid rows' })

  const board = await env.DB.prepare('SELECT payload FROM boards WHERE id = ?').bind(hook.board_id).first()
  if (!board) return reply(404, { error: 'board_not_found' })
  let payload
  try { payload = JSON.parse(board.payload) } catch (e) { payload = {} }
  const charts = Array.isArray(payload.charts) ? payload.charts : []
  const chart = charts.find((c) => c.id === hook.chart_id)
  if (!chart) return reply(404, { error: 'chart_not_found' })

  chart.data = data
  chart.automation = { ...(chart.automation || {}), kind: 'push', enabled: true, hookToken: token, lastRunAt: Date.now(), lastError: '', nextRunAt: 0 }
  await env.DB.prepare('UPDATE boards SET payload = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(payload), Date.now(), hook.board_id).run()
  try {
    const stub = env.ROOM.get(env.ROOM.idFromName('board:' + hook.board_id))
    await stub.fetch('https://room/notify', { method: 'POST' })
  } catch (e) { /* best effort */ }
  return reply(200, { ok: true, rows: data.length })
}

// Authenticated: create (or return) the hook token for a chart.
export async function createChartHook(env, user, request) {
  let body = {}
  try { body = await request.json() } catch (e) {}
  const chartId = String(body.chartId || '')
  const boardId = String(body.boardId || '')
  if (!chartId || !boardId) return json({ error: 'Missing chartId/boardId' }, 400)
  const board = await env.DB.prepare('SELECT id FROM boards WHERE id = ? AND user_id = ?').bind(boardId, user.id).first()
  if (!board) return json({ error: 'Not found' }, 404)
  let row = await env.DB.prepare('SELECT token FROM chart_hooks WHERE board_id = ? AND chart_id = ?').bind(boardId, chartId).first()
  if (!row) {
    const token = randomToken(18)
    await env.DB.prepare('INSERT INTO chart_hooks (token, board_id, chart_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(token, boardId, chartId, user.id, Date.now()).run()
    row = { token }
  }
  const base = (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, '')
  return json({ token: row.token, url: `${base}/api/hooks/${row.token}` })
}

// Authenticated: revoke a chart's hook.
export async function revokeChartHook(env, user, request) {
  let body = {}
  try { body = await request.json() } catch (e) {}
  const chartId = String(body.chartId || '')
  const boardId = String(body.boardId || '')
  if (!chartId || !boardId) return json({ error: 'Missing chartId/boardId' }, 400)
  await env.DB.prepare('DELETE FROM chart_hooks WHERE board_id = ? AND chart_id = ? AND user_id = ?')
    .bind(boardId, chartId, user.id).run()
  return json({ ok: true })
}
