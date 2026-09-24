// ---- Persistence / state store for SimpleBoard -------------------------------

import {
  apiCreateBoard, apiDeleteBoard, apiGetBoard, apiGetShare, apiListBoards,
  apiOpenBoardSocket, apiOpenShareSocket, apiPutBoard, apiPutShare, apiRenameBoard,
} from './api.js'

const DB_NAME = 'myboard'
const DB_STORE = 'state'
const DB_KEY = 'main'
const SAVE_MS = 350

// One cork board per app. The cork plane is a WORLD_SIZE x WORLD_SIZE square
// centred on the origin; items live here in world coordinates and are clamped
// so they can never be dragged off the board onto the brown void behind it.

// The cork plane is a WORLD_SIZE square centred on the origin. Everything lives
// in world coordinates that must stay on the cork, otherwise items can be
// dropped beyond the board's edge and become unrecoverable. These bounds are
// shared with the camera so panning can never wander into blank background.
export const WORLD_SIZE = 240000
export const WORLD_HALF = WORLD_SIZE / 2
export const CORK_MIN = -WORLD_HALF
export const CORK_MAX = WORLD_HALF

export function clampToCork(x, y, w, h) {
  return {
    x: Math.max(CORK_MIN, Math.min(CORK_MAX - (w || 0), x)),
    y: Math.max(CORK_MIN, Math.min(CORK_MAX - (h || 0), y)),
  }
}

let db = null
let saveTimer = null
let state = null
let snapshot = null
let listeners = new Set()
const history = []
const redo = []

// Which board this browser is currently editing. The guest board uses the
// original key; each signed-in account gets its own namespaced local cache so
// two people on the same device never see each other's notes.
let storageKey = DB_KEY
let currentUserId = null
let boards = []

// Sync bookkeeping: every local edit bumps `localVersion`; a successful push
// records `pushedVersion`. While the two differ we have unsaved local changes,
// so an incoming realtime ping must NOT overwrite them with an older board
// (our own pushes also trigger pings, which could otherwise clobber newer edits).
let localVersion = 0
let pushedVersion = 0
function markLocalChange() {
  localVersion++
  maybeSendActivity()
}

// Tell the room we're editing (throttled) so others get an activity notice.
function maybeSendActivity() {
  if (!apiSocket) return
  const now = Date.now()
  if (now - lastActivityAt >= 1200) {
    lastActivityAt = now
    apiSocket.send(JSON.stringify({ t: 'activity', what: 'edited' }))
  }
  // Keep our selection/caret fresh while we work (typing moves nothing).
  sendCursor()
}

function sendCursor() {
  if (!apiSocket) return
  apiSocket.send(JSON.stringify({
    t: 'cursor',
    wx: lastPointer.wx,
    wy: lastPointer.wy,
    sel: (state.selectedIds || []).slice(0, 25),
  }))
}

// Called as the local pointer moves over the board.
export function reportCursor(wx, wy) {
  lastPointer = { wx, wy }
  const now = Date.now()
  if (now - lastCursorAt < 120) return
  lastCursorAt = now
  sendCursor()
}

// Selection changed: share it right away so others see what we're on.
function reportSelection() {
  sendCursor()
}

// Display identity for presence. `id` should be unique per browser tab.
export function setSelfIdentity(next) {
  const merged = { ...(self || {}), ...(next || {}) }
  if (self && merged.id === self.id && merged.name === self.name && merged.kind === self.kind) return
  self = merged
  ensureSocket()
}

export function getPeers() {
  return peers
}

export function onActivity(fn) {
  activityCb = fn
}

function setPeers(next) {
  peers = Array.isArray(next) ? next : []
  // Drop cursors for anyone who has left.
  const live = new Set(peers.map((p) => p.id))
  let changed = false
  const pruned = {}
  for (const [id, c] of Object.entries(cursors)) {
    if (live.has(id)) pruned[id] = c
    else { changed = true; clearTimeout(cursorClearTimers.get(id)); cursorClearTimers.delete(id) }
  }
  if (changed) cursors = pruned
  state = { ...state, peers, cursors }
  emit()
}

function setCursors() {
  state = { ...state, cursors }
  emit()
}

// A peer's caret moved / selection changed.
function applyCursor(msg) {
  const peer = msg.peer || {}
  if (!peer.id) return
  if (self && peer.id === self.id) return
  const prev = cursors[peer.id]
  cursors = {
    ...cursors,
    [peer.id]: {
      id: peer.id,
      name: peer.name || (prev && prev.name) || 'Guest',
      color: peer.color || (prev && prev.color) || '#8a7a63',
      wx: msg.wx,
      wy: msg.wy,
      sel: Array.isArray(msg.sel) ? msg.sel : [],
      editing: true,
    },
  }
  clearTimeout(cursorClearTimers.get(peer.id))
  cursorClearTimers.set(peer.id, setTimeout(() => {
    const c = cursors[peer.id]
    if (!c) return
    cursors = { ...cursors, [peer.id]: { ...c, editing: false } }
    setCursors()
  }, 3500))
  setCursors()
}

function dropCursor(id) {
  if (!cursors[id]) return
  const next = { ...cursors }
  delete next[id]
  cursors = next
  clearTimeout(cursorClearTimers.get(id))
  cursorClearTimers.delete(id)
  setCursors()
}

// Incoming socket messages: a plain "changed" ping means re-pull; JSON carries
// presence, activity and cursors.
function handleSocketData(data) {
  if (data === 'changed' || typeof data !== 'string') {
    pullCloud()
    return
  }
  if (data[0] !== '{') {
    pullCloud()
    return
  }
  let msg = null
  try { msg = JSON.parse(data) } catch (e) { pullCloud(); return }
  if (!msg || !msg.t) { pullCloud(); return }
  if (msg.t === 'presence') {
    setPeers(msg.peers)
    return
  }
  if (msg.t === 'full') {
    // Free boards allow one guest at a time; the room turned us away.
    if (apiSocket) { try { apiSocket.close() } catch (e) {} apiSocket = null }
    stopSharePoll()
    cloudSubReady = false
    cloudEnabled = false
    if (shareFullCb) shareFullCb()
    return
  }
  if (msg.t === 'cursor') {
    applyCursor(msg)
    return
  }
  if (msg.t === 'activity') {
    if (msg.what === 'left' && msg.peer) { dropCursor(msg.peer.id); return }
    if (activityCb && msg.peer && msg.what !== 'joined') {
      if (!self || msg.peer.id !== self.id) activityCb(msg)
    }
  }
}
function isDirty() { return localVersion > pushedVersion }

export const NOTE_COLORS = {
  white: '#fdfaf1',
  yellow: '#fff8c4',
  blue: '#cfe6ff',
  pink: '#ffd6e6',
  green: '#d5f0c8',
  kraft: '#efe2c8',
}

export const NOTE_LINE = {
  white: '#d8e6f0',
  yellow: '#e8dc9a',
  blue: '#b3cbe8',
  pink: '#f0b6cd',
  green: '#b8dcab',
  kraft: '#d9c8a2',
}

const PAPER_MARGIN = '#e6b4a2'

export function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)
}

function defaultState() {
  return {
    savedAt: Date.now(),
    view: { x: (typeof window !== 'undefined' ? window.innerWidth : 1280) / 2, y: (typeof window !== 'undefined' ? window.innerHeight : 800) / 2, s: 1 },
    notes: [],
    pins: [],
    clips: [],
    music: [],
    cards: [],
    envelopes: [],
    links: [],
    selected: null,
    selectedIds: [],
    mode: 'move',
    boards: [],
    boardId: null,
    boardName: '',
    boardSlug: '',
    peers: [],
    cursors: {},
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function loadFromDB(key = storageKey) {
  try {
    if (!db) db = await openDB()
    const raw = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly')
      const r = tx.objectStore(DB_STORE).get(key)
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const val = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (val && val.notes && val.view) return val
  } catch (e) {
    console.warn('IndexedDB load failed', e)
  }
  const ls = localStorage.getItem(key)
  if (ls) {
    try {
      const v = JSON.parse(ls)
      if (v && v.notes) return v
    } catch (e) {}
  }
  return null
}

function hydrate(saved) {
  const base = defaultState()
  const merged = saved
    ? {
        ...base,
        ...saved,
        notes: saved.notes || [],
        pins: saved.pins || [],
        clips: saved.clips || [],
        music: saved.music || [],
        cards: Array.isArray(saved.cards) ? saved.cards : [],
        envelopes: saved.envelopes || [],
        links: Array.isArray(saved.links) ? saved.links : [],
        selected: null,
        selectedIds: [],
        peers: [],
        cursors: {},
        boardSlug: '',
        view: { ...base.view, ...(saved.view || {}) },
      }
    : base
  // Basic shape repair
  merged.notes = merged.notes.map((n, i) => ({
    id: n.id || uid() + i,
    x: isFinite(n.x) ? n.x : 0, y: isFinite(n.y) ? n.y : 0,
    w: n.w || 250, h: n.h || 300, sh: n.sh || n.h || 300,
    color: n.color || 'white', text: n.text || '',
    attachments: Array.isArray(n.attachments) ? n.attachments : [],
    rotation: n.rotation ?? 0, groupId: null,
  }))
  merged.clips = merged.clips.map((c, i) => ({
    id: c.id || uid() + i,
    x: isFinite(c.x) ? c.x : 0, y: isFinite(c.y) ? c.y : 0,
    w: c.w || 220, h: c.h || 180, url: c.url || '', rotation: c.rotation ?? 0,
  })).filter((c) => c.url)
  merged.music = merged.music.map((m, i) => ({
    id: m.id || uid() + i,
    x: isFinite(m.x) ? m.x : 0, y: isFinite(m.y) ? m.y : 0,
    w: m.w || 320, h: m.h || 180, url: m.url || '', title: m.title || 'Untitled mixtape',
  })).filter((m) => m.url)
  merged.notes.forEach((n) => {
    ;(n.attachments || []).forEach((attachment, i) => {
      if (attachment.url) merged.clips.push({
        id: attachment.id || uid() + i,
        x: n.x + n.w + 28,
        y: n.y + 18 + i * 18,
        w: 220,
        h: 180,
        url: attachment.url,
        rotation: Math.random() * 4 - 2,
      })
    })
    delete n.attachments
  })
  merged.envelopes = merged.envelopes.map((e, i) => ({
    id: e.id || uid() + i,
    x: isFinite(e.x) ? e.x : 0, y: isFinite(e.y) ? e.y : 0,
    w: e.w || 300, h: e.h || 210,
    title: e.title || 'Untitled', noteIds: e.noteIds || [], expanded: !!e.expanded,
  }))
  merged.pins = merged.pins.map((p, i) => ({
    id: p.id || uid() + i,
    x: isFinite(p.x) ? p.x : 0, y: isFinite(p.y) ? p.y : 0,
    color: p.color || '#d64545', location: p.location || null,
  }))
  merged.envelopes.forEach((e) => {
    const ids = new Set(e.noteIds)
    merged.notes.forEach((n) => {
      const inEnv = ids.has(n.id)
      if (inEnv && n.groupId !== e.id) n.groupId = e.id
      if (!inEnv && n.groupId === e.id) n.groupId = null
    })
  })
  const noteIdSet = new Set(merged.notes.map((n) => n.id))
  merged.links = (merged.links || [])
    .filter((l) => l && noteIdSet.has(l.from) && noteIdSet.has(l.to) && l.from !== l.to)
    .map((l, i) => ({ id: l.id || uid() + i, from: l.from, to: l.to, type: l.type || 'related', label: l.label || '' }))
  return merged
}

// Point the store at a local cache key, load it, and reset the undo stacks.
async function applyKey(key) {
  storageKey = key
  const saved = await loadFromDB(key)
  const merged = hydrate(saved)
  state = merged
  snapshot = merged
  history.length = 0
  redo.length = 0
  emit()
  return { fresh: !saved }
}

export async function initStore() {
  // Guest board shown until auth resolves; replaced by loadBoard().
  return applyKey(DB_KEY)
}

const lastBoardKey = (uid) => `myboard.lastBoard:${uid}`

// Load one board's payload into the store (local cache + cloud mirror).
async function loadBoardContent(id) {
  boardRowId = id
  const local = await applyKey(`board:${id}`)
  if (currentUserId) localStorage.setItem(lastBoardKey(currentUserId), id)
  localVersion = 0
  pushedVersion = 0
  let remoteFresh = true
  if (id) {
    const hadRemote = await pullCloud()
    remoteFresh = !hadRemote
    if (!hadRemote && !local.fresh) await pushNow()
  }
  // Point realtime (and presence) at this board.
  ensureSocket()
  return { fresh: local.fresh && remoteFresh }
}

// Sign in: fetch the account's boards (creating a first one if needed) and open
// the most recently used one — or `desiredSlug` when a /b/<slug> link is opened.
export async function loadBoard(userId, desiredSlug) {
  currentUserId = userId || null
  sharedToken = null
  sharedMode = 'view'
  sharedName = ''
  setCloudUser(currentUserId)
  let list = []
  if (currentUserId) {
    const res = await apiListBoards()
    if (res && !res.error && Array.isArray(res.boards)) list = res.boards
    if (!list.length) {
      const created = await apiCreateBoard('My Board')
      if (created && !created.error) list = [{ id: created.id, name: created.name, updatedAt: created.updatedAt, slug: created.slug }]
    }
  }
  boards = list
  let chosen = null
  if (currentUserId && list.length) {
    if (desiredSlug) chosen = list.find((b) => b.slug === desiredSlug || b.id === desiredSlug) || null
    if (!chosen) {
      const last = localStorage.getItem(lastBoardKey(currentUserId))
      chosen = list.find((b) => b.id === last) || list[0]
    }
  }
  let loaded = { fresh: true }
  if (chosen) loaded = await loadBoardContent(chosen.id)
  else { boardRowId = null; loaded = await applyKey(DB_KEY) }
  state = {
    ...state, boards: list,
    boardId: chosen ? chosen.id : null,
    boardName: chosen ? chosen.name : '',
    boardSlug: chosen ? (chosen.slug || chosen.id) : '',
  }
  snapshot = state
  emit()
  return { fresh: loaded.fresh }
}

// Switch to another board of the same account.
export async function openBoard(id) {
  if (!id || id === boardRowId) return { fresh: false }
  sharedToken = null
  sharedMode = 'view'
  sharedName = ''
  saveNow()
  const loaded = await loadBoardContent(id)
  const meta = boards.find((b) => b.id === id)
  state = {
    ...state, boards, boardId: id,
    boardName: meta ? meta.name : '',
    boardSlug: meta ? (meta.slug || id) : id,
  }
  snapshot = state
  emit()
  return loaded
}

// Create a new board and open it. Returns the response (may carry an error,
// e.g. plan board-limit).
export async function createBoard(name) {
  const res = await apiCreateBoard(name || 'New board')
  if (!res || res.error) return res
  boards = [...boards, { id: res.id, name: res.name, updatedAt: res.updatedAt, slug: res.slug }]
  await openBoard(res.id)
  return res
}

export async function renameBoard(id, name) {
  const clean = String(name || '').trim().slice(0, 80)
  if (!clean) return
  const res = await apiRenameBoard(id, clean)
  if (res && res.error) return
  boards = boards.map((b) => (b.id === id ? { ...b, name: clean } : b))
  state = { ...state, boards, boardName: id === boardRowId ? clean : state.boardName }
  snapshot = state
  emit()
}

// Record a board's share link in the local board list (so the gallery can show
// a "shared" badge without a refetch).
export function setBoardShare(id, shareToken, shareMode) {
  boards = boards.map((b) => (b.id === id ? { ...b, shareToken, shareMode } : b))
  state = { ...state, boards }
  snapshot = state
  emit()
}

export async function deleteBoard(id) {
  const res = await apiDeleteBoard(id)
  if (res && res.error) return
  boards = boards.filter((b) => b.id !== id)
  try { localStorage.removeItem(`board:${id}`) } catch (e) { /* ignore */ }
  if (id === boardRowId) {
    if (boards.length) await openBoard(boards[0].id)
    else await createBoard('My Board')
  } else {
    state = { ...state, boards }
    snapshot = state
    emit()
  }
}

// Open a board through a public share link (no account required). The board is
// fetched live and cached locally so a reload works offline. View links are
// read-only; edit links push changes back through the share endpoint.
export async function loadShared(token) {
  const res = await apiGetShare(token)
  if (!res || res.error) return { error: (res && res.error) || { message: 'Not found' } }
  currentUserId = null
  boards = []
  boardRowId = null
  sharedToken = token
  sharedMode = res.mode === 'edit' ? 'edit' : 'view'
  sharedName = res.name || 'Shared board'
  await applyKey(`share:${token}`)
  let parsed = null
  try { parsed = JSON.parse(res.payload) } catch (e) { parsed = null }
  if (parsed && Array.isArray(parsed.notes)) {
    const merged = hydrate(parsed)
    state = merged
    snapshot = merged
  }
  state = { ...state, boardId: res.id, boardName: res.name || 'Shared board', boardSlug: '', boards: [] }
  snapshot = state
  history.length = 0
  redo.length = 0
  localVersion = 0
  pushedVersion = 0
  cloudUser = 'share:' + token
  cloudEnabled = true
  ensureSocket()
  emit()
  return { ok: true, mode: sharedMode, name: res.name || 'Shared board' }
}

// Leave the current board (sign-out): stop syncing and blank the canvas.
export function resetBoard() {
  currentUserId = null
  boards = []
  boardRowId = null
  sharedToken = null
  sharedMode = 'view'
  sharedName = ''
  setCloudUser(null)
  storageKey = DB_KEY
  state = defaultState()
  snapshot = state
  history.length = 0
  redo.length = 0
  localVersion = 0
  pushedVersion = 0
  emit()
}

export function getCurrentUserId() {
  return currentUserId
}

export function getState() {
  return snapshot
}

function emit() {
  snapshot = state
  listeners.forEach((l) => l())
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!state) return
  persistLocal()
  scheduleCloudPush()
}

// Write the current state to the local cache only — no cloud push and no
// "unsaved local edit" bookkeeping. Used when applying remote updates.
function persistLocal() {
  if (!state) return
  const payload = JSON.stringify(state)
  try {
    localStorage.setItem(storageKey, payload)
  } catch (e) {
    console.warn('localStorage full, skipping cache', e)
  }
  if (db) {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).put(payload, storageKey)
  }
}

function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, SAVE_MS)
}

function onVisibility() {
  if (document.visibilityState === 'hidden') saveNow()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', saveNow)
  document.addEventListener('visibilitychange', onVisibility)
}

// ---- history ---------------------------------------------------------------

let lastCapture = 0
const CAPTURE_GAP = 600

function capture() {
  const now = Date.now()
  if (history.length && now - lastCapture < CAPTURE_GAP) {
    lastCapture = now
    return
  }
  lastCapture = now
  history.push(state)
  if (history.length > 40) history.shift()
  redo.length = 0
}

export function undo() {
  if (!history.length) return
  redo.push(state)
  state = history.pop()
  state = { ...state, selected: null, selectedIds: [] }
  emit()
  scheduleSave()
}

export function redoFn() {
  if (!redo.length) return
  history.push(state)
  state = redo.pop()
  state = { ...state, selected: null, selectedIds: [] }
  emit()
  scheduleSave()
}

// ---- helpers ---------------------------------------------------------------

function mutate(fn) {
  capture()
  state = fn(state)
  markLocalChange()
  emit()
  scheduleSave()
}

export function setView(view) {
  state = { ...state, view: { ...state.view, ...view } }
  emit()
}

// Selection: `selectedIds` is the set of highlighted items; `selected` is the
// "primary" (last-clicked) one used for the format bar, backlinks, etc.
export function select(id) {
  const next = id ? [id] : []
  const cur = state.selectedIds || []
  if (state.selected === (id || null) && cur.length === next.length && cur.every((x, i) => x === next[i])) return
  state = { ...state, selected: id || null, selectedIds: next }
  emit()
  reportSelection()
}

export function toggleSelect(id) {
  const cur = state.selectedIds || []
  const has = cur.includes(id)
  const next = has ? cur.filter((x) => x !== id) : [...cur, id]
  state = {
    ...state,
    selectedIds: next,
    selected: has ? (next.length ? next[next.length - 1] : null) : id,
  }
  emit()
  reportSelection()
}

export function selectMany(ids) {
  const next = [...new Set(ids)]
  const cur = state.selectedIds || []
  if (cur.length === next.length && cur.every((x, i) => x === next[i])) return
  state = { ...state, selectedIds: next, selected: next.length ? next[next.length - 1] : null }
  emit()
  reportSelection()
}

export function clearSelection() {
  if ((state.selectedIds || []).length === 0 && !state.selected) return
  state = { ...state, selected: null, selectedIds: [] }
  emit()
  reportSelection()
}

export function setMode(mode) {
  if (state.mode === mode) return
  state = { ...state, mode }
  emit()
}

export function findNote(id) {
  return state.notes.find((n) => n.id === id) || null
}

export function findEnvelope(id) {
  return state.envelopes.find((e) => e.id === id) || null
}

// ---- items -----------------------------------------------------------------

export function addNote(x, y, text = '', color = 'white') {
  const note = {
    id: uid(), x: x - 125, y: y - 150, w: 250, h: 300, sh: 300,
    color, text, rotation: (Math.random() * 4 - 2), groupId: null,
  }
  const p = clampToCork(note.x, note.y, note.w, note.h)
  note.x = p.x; note.y = p.y
  mutate((s) => ({ ...s, notes: [...s.notes, note], selected: note.id, selectedIds: [note.id], mode: 'move' }))
  return note
}

export function addPin(x, y, color) {
  const colors = ['#d64545', '#3a7bd5', '#f2b632', '#3aa655', '#8a6dc9']
  const pin = { id: uid(), x, y, color: color || colors[Math.floor(Math.random() * colors.length)], location: null }
  mutate((s) => ({ ...s, pins: [...s.pins, pin], selected: pin.id, selectedIds: [pin.id], mode: 'move' }))
  return pin
}

export function addClip(url, x, y) {
  const clip = { id: uid(), x, y, w: 220, h: 180, url, rotation: Math.random() * 4 - 2 }
  mutate((s) => ({ ...s, clips: [...s.clips, clip], selected: clip.id, selectedIds: [clip.id], mode: 'move' }))
  return clip
}

export function addMusic(url, x, y, title) {
  const music = { id: uid(), x, y, w: 320, h: 180, url, title: title || 'Untitled mixtape' }
  mutate((s) => ({ ...s, music: [...s.music, music], selected: music.id, selectedIds: [music.id], mode: 'move' }))
  return music
}

// A saved-link "article card": a link plus its fetched Open Graph metadata.
export function addCard(x, y, preview) {
  const card = {
    id: uid(), x, y, w: 300, h: 300,
    url: preview.url, title: preview.title || '', description: preview.description || '',
    image: preview.image || '', favicon: preview.favicon || '', siteName: preview.siteName || '',
    rotation: Math.random() * 3 - 1.5,
  }
  mutate((s) => ({ ...s, cards: [...s.cards, card], selected: card.id, selectedIds: [card.id], mode: 'move' }))
  return card
}

export function addEnvelope(x, y) {
  const env = { id: uid(), x: x - 150, y: y - 105, w: 300, h: 210, title: 'My letters', noteIds: [], expanded: false }
  mutate((s) => ({ ...s, envelopes: [...s.envelopes, env], selected: env.id, selectedIds: [env.id], mode: 'move' }))
  return env
}

export function updateNote(id, patch) {
  mutate((s) => ({
    ...s,
    notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
  }))
}

// Live height sync during typing: updates state without polluting undo history.
export function updateNoteLive(id, patch) {
  const note = state.notes.find((n) => n.id === id)
  if (note) {
    let changed = false
    for (const k in patch) { if (note[k] !== patch[k]) { changed = true; break } }
    if (!changed) return
  }
  state = {
    ...state,
    notes: state.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
  }
  markLocalChange()
  emit()
  scheduleSave()
}

export function updateEnvelope(id, patch) {
  mutate((s) => ({
    ...s,
    envelopes: s.envelopes.map((e) => (e.id === id ? { ...e, ...patch } : e)),
  }))
}

export function updatePin(id, patch) {
  mutate((s) => ({
    ...s,
    pins: s.pins.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  }))
}

// bring to front + move
export function moveNote(id, x, y) {
  mutate((s) => {
    const rest = s.notes.filter((n) => n.id !== id)
    const item = s.notes.find((n) => n.id === id)
    if (!item) return s
    const p = clampToCork(x, y, item.w || 250, item.h || 300)
    return { ...s, notes: [...rest, { ...item, x: p.x, y: p.y }] }
  })
}

export function moveEnvelope(id, x, y) {
  mutate((s) => {
    const rest = s.envelopes.filter((e) => e.id !== id)
    const item = s.envelopes.find((e) => e.id === id)
    if (!item) return s
    const p = clampToCork(x, y, item.w || 0, item.h || 0)
    return { ...s, envelopes: [...rest, { ...item, x: p.x, y: p.y }] }
  })
}

export function movePin(id, x, y) {
  mutate((s) => {
    const rest = s.pins.filter((p) => p.id !== id)
    const item = s.pins.find((p) => p.id === id)
    if (!item) return s
    // The pin's drag origin sits at its head (top), so use the head box to
    // clamp so the whole pin can never be placed off the cork either.
    const p = clampToCork(x - 20, y - 60, 40, 80)
    return { ...s, pins: [...rest, { ...item, x: p.x + 20, y: p.y + 60 }] }
  })
}

export function moveClip(id, x, y) {
  mutate((s) => {
    const rest = s.clips.filter((c) => c.id !== id)
    const item = s.clips.find((c) => c.id === id)
    if (!item) return s
    const p = clampToCork(x, y, item.w, item.h)
    return { ...s, clips: [...rest, { ...item, x: p.x, y: p.y }] }
  })
}

export function updateClip(id, patch) {
  mutate((s) => ({
    ...s,
    clips: s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  }))
}

export function updateMusic(id, patch) {
  mutate((s) => ({ ...s, music: s.music.map((m) => (m.id === id ? { ...m, ...patch } : m)) }))
}

export function updateCard(id, patch) {
  mutate((s) => ({ ...s, cards: s.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
}

export function moveCard(id, x, y) {
  mutate((s) => {
    const rest = s.cards.filter((c) => c.id !== id)
    const item = s.cards.find((c) => c.id === id)
    if (!item) return s
    const p = clampToCork(x, y, item.w, item.h)
    return { ...s, cards: [...rest, { ...item, x: p.x, y: p.y }] }
  })
}

export function moveMusic(id, x, y) {
  mutate((s) => {
    const rest = s.music.filter((m) => m.id !== id)
    const item = s.music.find((m) => m.id === id)
    if (!item) return s
    const p = clampToCork(x, y, item.w, item.h)
    return { ...s, music: [...rest, { ...item, x: p.x, y: p.y }] }
  })
}

export function collectNote(noteId, envId) {
  mutate((s) => ({
    ...s,
    noteIdsDirty: true,
    notes: s.notes.map((n) => (n.id === noteId ? { ...n, groupId: envId } : n)),
    envelopes: s.envelopes.map((e) =>
      e.id === envId && !e.noteIds.includes(noteId) ? { ...e, noteIds: [...e.noteIds, noteId], expanded: true } : e
    ),
  }))
}

export function detachNote(noteId) {
  mutate((s) => {
    const note = s.notes.find((n) => n.id === noteId)
    const gid = note && note.groupId
    return {
      ...s,
      notes: s.notes.map((n) => (n.id === noteId ? { ...n, groupId: null } : n)),
      envelopes: s.envelopes.map((e) =>
        e.id === gid ? { ...e, noteIds: e.noteIds.filter((id) => id !== noteId), expanded: e.noteIds.length > 1 } : e
      ),
    }
  })
}

export function toggleEnvelope(id) {
  mutate((s) => ({
    ...s,
    envelopes: s.envelopes.map((e) => (e.id === id ? { ...e, expanded: !e.expanded } : e)),
  }))
}

// Red-string links between notes (detective-corkboard style). Stored directed
// (from → to) so we can show backlinks, but rendered as one undirected rope.
export function addLink(from, to, type = 'related') {
  if (!from || !to || from === to) return null
  let created = null
  mutate((s) => {
    const links = s.links || []
    const dupe = links.some(
      (l) => (l.from === from && l.to === to) || (l.from === to && l.to === from)
    )
    if (dupe) return s
    created = { id: uid(), from, to, type, label: '' }
    return { ...s, links: [...links, created] }
  })
  return created
}

export function removeLink(id) {
  mutate((s) => ({ ...s, links: (s.links || []).filter((l) => l.id !== id) }))
}

export function updateLink(id, patch) {
  mutate((s) => ({
    ...s,
    links: (s.links || []).map((l) => (l.id === id ? { ...l, ...patch } : l)),
  }))
}

export function reverseLink(id) {
  mutate((s) => ({
    ...s,
    links: (s.links || []).map((l) => (l.id === id ? { ...l, from: l.to, to: l.from } : l)),
  }))
}

export function deleteItem(id) {
  mutate((s) => {
    const notes = s.notes.filter((n) => n.id !== id)
    const pins = s.pins.filter((p) => p.id !== id)
    const clips = s.clips.filter((c) => c.id !== id)
    const music = s.music.filter((m) => m.id !== id)
    const cards = (s.cards || []).filter((c) => c.id !== id)
    const links = (s.links || []).filter((l) => l.from !== id && l.to !== id)
    const env = s.envelopes.find((e) => e.id === id)
    if (env) {
      const gid = new Set(env.noteIds)
      return {
        ...s,
        notes: notes.map((n) => (gid.has(n.id) ? { ...n, groupId: null } : n)),
        envelopes: s.envelopes.filter((e) => e.id !== id),
        pins,
        clips,
        music,
        cards,
        links,
        selected: s.selected === id ? null : s.selected,
        selectedIds: (s.selectedIds || []).filter((x) => x !== id),
      }
    }
    const note = s.notes.find((n) => n.id === id)
    const gid = note ? note.groupId : null
    return {
      ...s,
      notes,
      pins,
      clips,
      music,
      cards,
      links,
      envelopes: gid
        ? s.envelopes.map((e) =>
            e.id === gid
              ? { ...e, noteIds: e.noteIds.filter((nid) => nid !== id), expanded: e.noteIds.length > 1 }
              : e
          )
        : s.envelopes,
      selected: s.selected === id ? null : s.selected,
      selectedIds: (s.selectedIds || []).filter((x) => x !== id),
    }
  })
}

export function duplicateItem(id) {
  mutate((s) => {
    const { notes, pins, envelopes } = s
    const found = notes.find((n) => n.id === id)
    if (found) {
      const copy = { ...found, id: uid(), x: found.x + 26, y: found.y + 26, groupId: null }
      return { ...s, notes: [...notes, copy], selected: copy.id, selectedIds: [copy.id] }
    }
    const env = envelopes.find((e) => e.id === id)
    if (env) {
      const copy = { ...env, id: uid(), x: env.x + 26, y: env.y + 26, noteIds: [], expanded: false, title: env.title + ' (copy)' }
      return { ...s, envelopes: [...envelopes, copy], selected: copy.id, selectedIds: [copy.id] }
    }
    const pin = pins.find((p) => p.id === id)
    if (pin) {
      const copy = { ...pin, id: uid(), x: pin.x + 26, y: pin.y + 26 }
      return { ...s, pins: [...pins, copy], selected: copy.id, selectedIds: [copy.id] }
    }
    const clip = s.clips.find((c) => c.id === id)
    if (clip) {
      const copy = { ...clip, id: uid(), x: clip.x + 26, y: clip.y + 26 }
      return { ...s, clips: [...s.clips, copy], selected: copy.id, selectedIds: [copy.id] }
    }
    const music = s.music.find((m) => m.id === id)
    if (music) {
      const copy = { ...music, id: uid(), x: music.x + 26, y: music.y + 26 }
      return { ...s, music: [...s.music, copy], selected: copy.id, selectedIds: [copy.id] }
    }
    const card = (s.cards || []).find((c) => c.id === id)
    if (card) {
      const copy = { ...card, id: uid(), x: card.x + 26, y: card.y + 26 }
      return { ...s, cards: [...s.cards, copy], selected: copy.id, selectedIds: [copy.id] }
    }
    return s
  })
}

export function clearBoard() {
  mutate((s) => ({ ...s, notes: [], pins: [], clips: [], music: [], cards: [], envelopes: [], links: [], selected: null, selectedIds: [] }))
}

// ---- multi-select operations -------------------------------------------------

function selectionIds() {
  const ids = state.selectedIds || []
  if (ids.length) return ids
  return state.selected ? [state.selected] : []
}

// Move every selected item by a delta (used by group drag).
export function moveItems(dx, dy) {
  const ids = selectionIds()
  if (!ids.length || (!dx && !dy)) return
  mutate((s) => {
    const set = new Set(ids)
    return {
      ...s,
      notes: s.notes.map((n) => {
        if (!set.has(n.id)) return n
        const p = clampToCork(n.x + dx, n.y + dy, n.w || 250, n.h || 300)
        return { ...n, x: p.x, y: p.y }
      }),
      pins: s.pins.map((p) => {
        if (!set.has(p.id)) return p
        const c = clampToCork(p.x - 20 + dx, p.y - 60 + dy, 40, 80)
        return { ...p, x: c.x + 20, y: c.y + 60 }
      }),
      clips: s.clips.map((c) => {
        if (!set.has(c.id)) return c
        const p = clampToCork(c.x + dx, c.y + dy, c.w, c.h)
        return { ...c, x: p.x, y: p.y }
      }),
      music: s.music.map((m) => {
        if (!set.has(m.id)) return m
        const p = clampToCork(m.x + dx, m.y + dy, m.w, m.h)
        return { ...m, x: p.x, y: p.y }
      }),
      cards: (s.cards || []).map((c) => {
        if (!set.has(c.id)) return c
        const p = clampToCork(c.x + dx, c.y + dy, c.w, c.h)
        return { ...c, x: p.x, y: p.y }
      }),
      envelopes: s.envelopes.map((e) => {
        if (!set.has(e.id)) return e
        const p = clampToCork(e.x + dx, e.y + dy, e.w, e.h)
        return { ...e, x: p.x, y: p.y }
      }),
    }
  })
}

export function deleteSelection() {
  const ids = selectionIds()
  if (!ids.length) return
  const set = new Set(ids)
  mutate((s) => ({
    ...s,
    notes: s.notes.filter((n) => !set.has(n.id)),
    pins: s.pins.filter((p) => !set.has(p.id)),
    clips: s.clips.filter((c) => !set.has(c.id)),
    music: s.music.filter((m) => !set.has(m.id)),
    cards: (s.cards || []).filter((c) => !set.has(c.id)),
    links: (s.links || []).filter((l) => !set.has(l.from) && !set.has(l.to)),
    envelopes: s.envelopes
      .filter((e) => !set.has(e.id))
      .map((e) => {
        const nids = e.noteIds.filter((nid) => !set.has(nid))
        return nids.length !== e.noteIds.length ? { ...e, noteIds: nids, expanded: nids.length > 1 } : e
      }),
    selected: null,
    selectedIds: [],
  }))
}

export function duplicateSelection() {
  const ids = selectionIds()
  if (!ids.length) return
  const set = new Set(ids)
  mutate((s) => {
    const newIds = []
    const notes = [...s.notes]
    s.notes.filter((n) => set.has(n.id)).forEach((n) => {
      const c = { ...n, id: uid(), x: n.x + 26, y: n.y + 26, groupId: null }
      notes.push(c); newIds.push(c.id)
    })
    const pins = [...s.pins]
    s.pins.filter((p) => set.has(p.id)).forEach((p) => { const c = { ...p, id: uid(), x: p.x + 26, y: p.y + 26 }; pins.push(c); newIds.push(c.id) })
    const clips = [...s.clips]
    s.clips.filter((x) => set.has(x.id)).forEach((x) => { const c = { ...x, id: uid(), x: x.x + 26, y: x.y + 26 }; clips.push(c); newIds.push(c.id) })
    const music = [...s.music]
    s.music.filter((x) => set.has(x.id)).forEach((x) => { const c = { ...x, id: uid(), x: x.x + 26, y: x.y + 26 }; music.push(c); newIds.push(c.id) })
    const cards = [...(s.cards || [])]
    ;(s.cards || []).filter((x) => set.has(x.id)).forEach((x) => { const c = { ...x, id: uid(), x: x.x + 26, y: x.y + 26 }; cards.push(c); newIds.push(c.id) })
    const envelopes = [...s.envelopes]
    s.envelopes.filter((x) => set.has(x.id)).forEach((x) => {
      const c = { ...x, id: uid(), x: x.x + 26, y: x.y + 26, noteIds: [], expanded: false, title: x.title + ' (copy)' }
      envelopes.push(c); newIds.push(c.id)
    })
    return {
      ...s, notes, pins, clips, music, cards, envelopes,
      selected: newIds.length ? newIds[newIds.length - 1] : null,
      selectedIds: newIds,
    }
  })
}

// ---- stacking order ----------------------------------------------------------

// Fallback stacking per item type (used until an item has been re-ordered).
export const Z_DEFAULT = { note: 10, pin: 8, clip: 12, music: 13, card: 11, envelope: 12 }

function effZ(item, kind) {
  return item && item.z != null ? item.z : (Z_DEFAULT[kind] ?? 10)
}

function zBounds(s) {
  let min = Infinity
  let max = -Infinity
  const scan = (arr, kind) => (arr || []).forEach((it) => {
    const z = effZ(it, kind)
    if (z < min) min = z
    if (z > max) max = z
  })
  scan(s.notes, 'note'); scan(s.pins, 'pin'); scan(s.clips, 'clip')
  scan(s.music, 'music'); scan(s.cards, 'card'); scan(s.envelopes, 'envelope')
  return { min, max }
}

function reorderZ(s, list, place) {
  const set = new Set(list)
  const { min, max } = zBounds(s)
  const base = place === 'front' ? (max === -Infinity ? 0 : max) : (min === Infinity ? 0 : min)
  const step = place === 'front' ? 1 : -1
  const order = new Map()
  list.forEach((id, i) => order.set(id, base + step * (i + 1)))
  const apply = (arr) => arr.map((it) => (set.has(it.id) ? { ...it, z: order.get(it.id) } : it))
  return {
    ...s,
    notes: apply(s.notes),
    pins: apply(s.pins),
    clips: apply(s.clips),
    music: apply(s.music),
    cards: apply(s.cards || []),
    envelopes: apply(s.envelopes),
  }
}

export function bringToFront(ids) {
  const list = Array.isArray(ids) ? ids : selectionIds()
  if (!list.length) return
  mutate((s) => reorderZ(s, list, 'front'))
}

export function sendToBack(ids) {
  const list = Array.isArray(ids) ? ids : selectionIds()
  if (!list.length) return
  mutate((s) => reorderZ(s, list, 'back'))
}

export function importState(data) {
  const base = defaultState()
  const s = {
    ...base,
    ...data,
    view: { ...base.view, ...(data.view || {}) },
    selected: null,
    selectedIds: [],
    mode: 'move',
    notes: (data.notes || []).map((n) => ({
      ...n,
      text: n.text || '',
      x: isFinite(n.x) ? n.x : 0,
      y: isFinite(n.y) ? n.y : 0,
      w: n.w || 250,
      h: n.h || 300,
      color: n.color || 'white',
      rotation: n.rotation ?? 0,
      groupId: n.groupId || null,
    })),
    pins: (data.pins || []).map((p) => ({ ...p, location: p.location || null })),
    clips: (data.clips || []).map((c) => ({ ...c, w: c.w || 220, h: c.h || 180 })).filter((c) => c.url),
    music: (data.music || []).map((m) => ({ ...m, w: m.w || 320, h: m.h || 180, title: m.title || 'Untitled mixtape' })).filter((m) => m.url),
    cards: (data.cards || []).map((c) => ({ ...c, w: c.w || 300, h: c.h || 300 })).filter((c) => c.url),
    envelopes: data.envelopes || [],
    links: Array.isArray(data.links) ? data.links : [],
  }
  const legacyClips = []
  s.notes = s.notes.map((n) => {
    ;(n.attachments || []).forEach((attachment, i) => {
      if (attachment.url) legacyClips.push({
        id: attachment.id || uid() + i,
        x: (n.x || 0) + (n.w || 250) + 28,
        y: (n.y || 0) + 18 + i * 18,
        w: 220,
        h: 180,
        url: attachment.url,
        rotation: Math.random() * 4 - 2,
      })
    })
    const { attachments, ...note } = n
    return note
  })
  s.clips.push(...legacyClips)
  s.envelopes.forEach((e) => {
    const ids = new Set(e.noteIds || [])
    s.notes.forEach((n) => {
      if (ids.has(n.id)) n.groupId = e.id
      else if (n.groupId === e.id) n.groupId = null
    })
  })
  const importedIds = new Set(s.notes.map((n) => n.id))
  s.links = s.links
    .filter((l) => l && importedIds.has(l.from) && importedIds.has(l.to) && l.from !== l.to)
    .map((l, i) => ({ id: l.id || uid() + i, from: l.from, to: l.to, type: l.type || 'related', label: l.label || '' }))
  state = s
  emit()
  saveNow()
}

export function exportData() {
  return JSON.stringify({ ...state, mode: 'move', selected: null, selectedIds: [] }, null, 1)
}

// ---- cloud sync (Cloudflare Worker API) -------------------------------------
//
// One board per account in D1, plus a Durable Object per account that pings
// other open devices over WebSocket when the board changes. Persistence stays
// local-first (IndexedDB + localStorage, namespaced per user); the Worker
// mirrors it for cross-device sync.

const CLOUD_PUSH_MS = 800
const SHARE_POLL_MS = 2000
let cloudTimer = null
let cloudPushBusy = false
let cloudSubReady = false
let cloudEnabled = false
let cloudUser = null
let boardRowId = null
let apiSocket = null
let sharePollTimer = null
// Presence: our own identity (display only) and the peers currently in the
// room. `activityCb` lets the UI show "X is editing" style notices.
let self = null
let peers = []
let activityCb = null
let lastActivityAt = 0
// Where other people are: their pointer (world coords) and current selection.
let cursors = {}
const cursorClearTimers = new Map()
let lastPointer = { wx: 0, wy: 0 }
let lastCursorAt = 0
// When set, the store is viewing a board through a public share link rather
// than the owner's account. `sharedMode` is 'view' (read-only) or 'edit'.
let sharedToken = null
let sharedMode = 'view'
let sharedName = ''
let shareChangeCb = null

export function isShared() {
  return !!sharedToken
}

export function getShareMode() {
  return sharedMode
}

// Notified when the link's mode/name changes (e.g. the owner flips view↔edit)
// or when it's revoked, so the UI can react without a reload.
export function onShareChange(fn) {
  shareChangeCb = fn
}

function applyShareMeta(mode, name) {
  const m = mode === 'edit' ? 'edit' : 'view'
  const n = name || sharedName
  if (m === sharedMode && n === sharedName) return
  sharedMode = m
  sharedName = n
  if (shareChangeCb) shareChangeCb({ mode: m, name: n })
}

export function hasCloud() {
  return true
}

// Point realtime sync at a user (or turn it off with null).
export function setCloudUser(userId) {
  const next = userId || null
  if (next === cloudUser) return
  cloudUser = next
  cloudEnabled = !!next
  stopCloud()
  if (next) startCloud()
}

function cloudPayload() {
  return JSON.stringify({
    notes: state.notes,
    pins: state.pins,
    clips: state.clips,
    music: state.music,
    cards: state.cards || [],
    envelopes: state.envelopes,
    links: state.links || [],
    view: state.view,
  })
}

export async function pushNow() {
  if (!cloudEnabled || cloudPushBusy) return
  if (!sharedToken && !boardRowId) return
  if (sharedToken && sharedMode !== 'edit') return
  const version = localVersion
  cloudPushBusy = true
  clearTimeout(cloudTimer)
  cloudTimer = null
  try {
    const res = sharedToken
      ? await apiPutShare(sharedToken, cloudPayload())
      : await apiPutBoard(boardRowId, cloudPayload())
    if (res && res.error) {
      if (sharedToken && (res.error.code === 'view_only' || res.error.status === 403)) {
        // The owner turned editing off while we were mid-edit. Drop our local
        // change, switch to view-only, and re-sync the authoritative board so
        // it's obvious the edit wasn't applied.
        sharedMode = 'view'
        localVersion = 0
        pushedVersion = 0
        if (shareChangeCb) shareChangeCb({ mode: 'view', name: sharedName })
        pullCloud()
      } else {
        console.warn('board sync: push failed', res.error.message)
      }
    } else if (version > pushedVersion) {
      pushedVersion = version
    }
  } finally {
    cloudPushBusy = false
  }
}

export function pushSoon() {
  if (!cloudEnabled || (!boardRowId && !sharedToken)) return
  if (sharedToken && sharedMode !== 'edit') return
  clearTimeout(cloudTimer)
  cloudTimer = setTimeout(pushNow, CLOUD_PUSH_MS)
}

function scheduleCloudPush() {
  pushSoon()
}

// Apply a remote snapshot into local state — only if it is materially
// different, and never clobber the camera mid-gesture.
function applyRemote(rawPayload) {
  if (!rawPayload) return
  let remote
  try {
    remote = JSON.parse(rawPayload)
  } catch (e) {
    return
  }
  if (!remote || !Array.isArray(remote.notes)) return
  const localJson = cloudPayload()
  const remoteJson = JSON.stringify({
    notes: remote.notes,
    pins: remote.pins || [],
    clips: remote.clips || [],
    music: remote.music || [],
    cards: remote.cards || [],
    envelopes: remote.envelopes || [],
    links: remote.links || [],
    view: remote.view,
  })
  if (localJson === remoteJson) return
  // Apply directly rather than via mutate(): remote content is not a local
  // edit, so it must not count as unsaved work (which would block further
  // pulls) nor push the same data straight back to the server.
  state = {
    ...state,
    notes: remote.notes || [],
    pins: remote.pins || [],
    clips: remote.clips || [],
    music: remote.music || [],
    cards: remote.cards || [],
    envelopes: remote.envelopes || [],
    links: remote.links || [],
    view: state.view.s === undefined ? remote.view || state.view : state.view,
  }
  emit()
  persistLocal()
}

export async function stopCloud() {
  cloudSubReady = false
  stopSharePoll()
  if (apiSocket) {
    try { apiSocket.close() } catch (e) {}
    apiSocket = null
  }
  setPeers([])
}

// (Re)connect the realtime socket for whatever we're currently looking at.
function ensureSocket() {
  if (!cloudEnabled) return
  if (!sharedToken && !boardRowId) return
  stopCloud()
  startCloud()
}

// Shared-board fallback poll: the WebSocket is instant when it works, but a
// viewer must never be stranded on stale content. Poll every couple of seconds
// while the tab is visible, and pull once immediately when it becomes visible.
function sharePollTick() {
  if (typeof document !== 'undefined' && document.hidden) return
  pullCloud()
}

function stopSharePoll() {
  if (sharePollTimer) { clearInterval(sharePollTimer); sharePollTimer = null }
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', sharePollTick)
}

function startSharePoll() {
  stopSharePoll()
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', sharePollTick)
  sharePollTimer = setInterval(sharePollTick, SHARE_POLL_MS)
}

export async function startCloud() {
  if (!cloudEnabled || cloudSubReady) return
  // Realtime: the Worker pings us, and we re-pull the current board. The
  // socket is board-scoped so it also carries who else is on this board.
  if (sharedToken) {
    apiSocket = apiOpenShareSocket(sharedToken, self, handleSocketData)
    startSharePoll()
  } else if (boardRowId) {
    apiSocket = apiOpenBoardSocket(boardRowId, self, handleSocketData)
  } else {
    return
  }
  cloudSubReady = true
}

// One-shot pull of the current board. Returns true when a remote board existed.
export async function pullCloud() {
  if (!cloudEnabled) return false
  if (!sharedToken && !boardRowId) return false
  const res = sharedToken ? await apiGetShare(sharedToken) : await apiGetBoard(boardRowId)
  if (res && res.error) {
    if (sharedToken && (res.error.status === 404 || res.error.code === 'not_found')) {
      loseShare()
    } else {
      console.warn('board sync: pull failed', res.error.message)
    }
    return false
  }
  // The owner may have flipped view↔edit (or renamed the board) since we loaded.
  if (sharedToken) applyShareMeta(res && res.mode, res && res.name)
  if (res && res.payload) {
    // A viewer has no local edits to protect; an editor does — never overwrite
    // unsynced local state with an older remote board.
    const viewing = !!sharedToken && sharedMode !== 'edit'
    if (!viewing && isDirty()) return false
    applyRemote(res.payload)
    return true
  }
  return false
}

// The shared link was revoked or deleted: drop the board and tell the app.
function loseShare() {
  sharedToken = null
  sharedMode = 'view'
  sharedName = ''
  cloudEnabled = false
  cloudUser = null
  stopCloud()
  state = defaultState()
  snapshot = state
  history.length = 0
  redo.length = 0
  emit()
  if (shareLostCb) shareLostCb()
}

let shareLostCb = null
export function onShareLost(fn) {
  shareLostCb = fn
}

let shareFullCb = null
export function onShareFull(fn) {
  shareFullCb = fn
}
