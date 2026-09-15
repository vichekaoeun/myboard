// ---- Persistence / state store for My Board -------------------------------

import { getSupabase, hasSupabase, BOARD_ROW_ID } from './supabase.js'

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
    envelopes: [],
    links: [],
    selected: null,
    mode: 'move',
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

async function loadFromDB() {
  try {
    if (!db) db = await openDB()
    const raw = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly')
      const r = tx.objectStore(DB_STORE).get(DB_KEY)
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const val = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (val && val.notes && val.view) return val
  } catch (e) {
    console.warn('IndexedDB load failed', e)
  }
  const ls = localStorage.getItem(DB_KEY)
  if (ls) {
    try {
      const v = JSON.parse(ls)
      if (v && v.notes) return v
    } catch (e) {}
  }
  return null
}

export async function initStore() {
  const saved = await loadFromDB()
  const base = defaultState()
  const merged = saved
    ? {
        ...base,
        ...saved,
        notes: saved.notes || [],
        pins: saved.pins || [],
        clips: saved.clips || [],
        music: saved.music || [],
        envelopes: saved.envelopes || [],
        links: Array.isArray(saved.links) ? saved.links : [],
        selected: null,
        view: { ...base.view, ...(saved.view || {}) },
      }
    : base
  // Basic shape repair
  merged.notes = merged.notes.map((n, i) => ({
    id: n.id || uid() + i,
    x: isFinite(n.x) ? n.x : 0, y: isFinite(n.y) ? n.y : 0,
    w: n.w || 250, h: n.h || 300,
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
    .map((l, i) => ({ id: l.id || uid() + i, from: l.from, to: l.to }))
  state = merged
  snapshot = merged
  return merged
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
  const payload = JSON.stringify(state)
  try {
    localStorage.setItem(DB_KEY, payload)
  } catch (e) {
    console.warn('localStorage full, skipping cache', e)
  }
  if (db) {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).put(payload, DB_KEY)
  }
  scheduleCloudPush()
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
  state = { ...state, selected: null }
  emit()
  scheduleSave()
}

export function redoFn() {
  if (!redo.length) return
  history.push(state)
  state = redo.pop()
  state = { ...state, selected: null }
  emit()
  scheduleSave()
}

// ---- helpers ---------------------------------------------------------------

function mutate(fn) {
  capture()
  state = fn(state)
  emit()
  scheduleSave()
}

export function setView(view) {
  state = { ...state, view: { ...state.view, ...view } }
  emit()
}

export function select(id) {
  if (state.selected === id) return
  state = { ...state, selected: id }
  emit()
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
  mutate((s) => ({ ...s, notes: [...s.notes, note], selected: note.id, mode: 'move' }))
  return note
}

export function addPin(x, y, color) {
  const colors = ['#d64545', '#3a7bd5', '#f2b632', '#3aa655', '#8a6dc9']
  const pin = { id: uid(), x, y, color: color || colors[Math.floor(Math.random() * colors.length)], location: null }
  mutate((s) => ({ ...s, pins: [...s.pins, pin], selected: pin.id, mode: 'move' }))
  return pin
}

export function addClip(url, x, y) {
  const clip = { id: uid(), x, y, w: 220, h: 180, url, rotation: Math.random() * 4 - 2 }
  mutate((s) => ({ ...s, clips: [...s.clips, clip], selected: clip.id, mode: 'move' }))
  return clip
}

export function addMusic(url, x, y, title) {
  const music = { id: uid(), x, y, w: 320, h: 180, url, title: title || 'Untitled mixtape' }
  mutate((s) => ({ ...s, music: [...s.music, music], selected: music.id, mode: 'move' }))
  return music
}

export function addEnvelope(x, y) {
  const env = { id: uid(), x: x - 150, y: y - 105, w: 300, h: 210, title: 'My letters', noteIds: [], expanded: false }
  mutate((s) => ({ ...s, envelopes: [...s.envelopes, env], selected: env.id, mode: 'move' }))
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
  state = {
    ...state,
    notes: state.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
  }
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
export function addLink(from, to) {
  if (!from || !to || from === to) return null
  let created = null
  mutate((s) => {
    const links = s.links || []
    const dupe = links.some(
      (l) => (l.from === from && l.to === to) || (l.from === to && l.to === from)
    )
    if (dupe) return s
    created = { id: uid(), from, to }
    return { ...s, links: [...links, created] }
  })
  return created
}

export function removeLink(id) {
  mutate((s) => ({ ...s, links: (s.links || []).filter((l) => l.id !== id) }))
}

export function deleteItem(id) {
  mutate((s) => {
    const notes = s.notes.filter((n) => n.id !== id)
    const pins = s.pins.filter((p) => p.id !== id)
    const clips = s.clips.filter((c) => c.id !== id)
    const music = s.music.filter((m) => m.id !== id)
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
        links,
        selected: null,
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
      links,
      envelopes: gid
        ? s.envelopes.map((e) =>
            e.id === gid
              ? { ...e, noteIds: e.noteIds.filter((nid) => nid !== id), expanded: e.noteIds.length > 1 }
              : e
          )
        : s.envelopes,
      selected: null,
    }
  })
}

export function duplicateItem(id) {
  mutate((s) => {
    const { notes, pins, envelopes } = s
    const found = notes.find((n) => n.id === id)
    if (found) {
      const copy = { ...found, id: uid(), x: found.x + 26, y: found.y + 26, groupId: null }
      return { ...s, notes: [...notes, copy], selected: copy.id }
    }
    const env = envelopes.find((e) => e.id === id)
    if (env) {
      const copy = { ...env, id: uid(), x: env.x + 26, y: env.y + 26, noteIds: [], expanded: false, title: env.title + ' (copy)' }
      return { ...s, envelopes: [...envelopes, copy], selected: copy.id }
    }
    const pin = pins.find((p) => p.id === id)
    if (pin) {
      const copy = { ...pin, id: uid(), x: pin.x + 26, y: pin.y + 26 }
      return { ...s, pins: [...pins, copy], selected: copy.id }
    }
    const clip = s.clips.find((c) => c.id === id)
    if (clip) {
      const copy = { ...clip, id: uid(), x: clip.x + 26, y: clip.y + 26 }
      return { ...s, clips: [...s.clips, copy], selected: copy.id }
    }
    const music = s.music.find((m) => m.id === id)
    if (music) {
      const copy = { ...music, id: uid(), x: music.x + 26, y: music.y + 26 }
      return { ...s, music: [...s.music, copy], selected: copy.id }
    }
    return s
  })
}

export function clearBoard() {
  mutate((s) => ({ ...s, notes: [], pins: [], clips: [], music: [], envelopes: [], links: [], selected: null }))
}

export function importState(data) {
  const base = defaultState()
  const s = {
    ...base,
    ...data,
    view: { ...base.view, ...(data.view || {}) },
    selected: null,
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
    .map((l, i) => ({ id: l.id || uid() + i, from: l.from, to: l.to }))
  state = s
  emit()
  saveNow()
}

export function exportData() {
  return JSON.stringify({ ...state, mode: 'move', selected: null }, null, 1)
}

// ---- cloud sync (Supabase, single board row) --------------------------------
//
// Everything is keyed off one fixed row (BOARD_ROW_ID) containing the whole
// board as JSON. Persistence remains fully local-first (IndexedDB + localStorage)
// and is the primary copy; Supabase mirrors it for cross-device sync.
// When the client can't reach Supabase (no env / offline / RLS), every cloud
// call is a silent no-op and the board is simply local-only.

const CLOUD_PUSH_MS = 800
const CLOUD_NONCE = 'board-id' // mirrors BOARD-side fingerprint of this device
let cloudTimer = null
let cloudSkipping = false
let lastCloudPayload = ''

let cloudPushBusy = false
let cloudChannel = null
let cloudSubReady = false

export function hasCloud() {
  return hasSupabase()
}

function cloudPayload() {
  return JSON.stringify({
    notes: state.notes,
    pins: state.pins,
    clips: state.clips,
    music: state.music,
    envelopes: state.envelopes,
    links: state.links || [],
    view: state.view,
  })
}

export async function pushNow() {
  if (!hasSupabase() || cloudPushBusy) return
  cloudPushBusy = true
  clearTimeout(cloudTimer)
  cloudTimer = null
  try {
    const sup = getSupabase()
    if (!sup) return
    await sup.from('boards').upsert(
      {
        id: BOARD_ROW_ID,
        payload: cloudPayload(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
  } catch (e) {
    console.warn('board sync: push failed', e && e.message)
  } finally {
    cloudPushBusy = false
  }
}

export function pushSoon() {
  if (!hasSupabase()) return
  clearTimeout(cloudTimer)
  cloudTimer = setTimeout(pushNow, CLOUD_PUSH_MS)
}

function scheduleCloudPush() {
  pushSoon()
}

// Apply a remote snapshot into local state — only if it is actually newer or
// materially different, and never clobber the camera mid-gesture.
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
  if (localJson === JSON.stringify({ notes: remote.notes, pins: remote.pins, envelopes: remote.envelopes, links: remote.links || [], view: remote.view })) return
  mutate((s) => ({
    ...s,
    notes: remote.notes || [],
    pins: remote.pins || [],
    clips: remote.clips || [],
    music: remote.music || [],
    envelopes: remote.envelopes || [],
    links: remote.links || [],
    view: s.view.s === undefined ? remote.view || s.view : s.view,
  }))
}

function onRow(payload) {
  const row = payload && payload.new
  if (!row || !row.payload) return
  applyRemote(row.payload)
}

export async function stopCloud() {
  if (cloudChannel) {
    try {
      await supabaseRef.channel(cloudChannel).unsubscribe()
    } catch (e) {}
    cloudChannel = null
  }
  cloudSubReady = false
}

let supabaseRef = null

export async function startCloud() {
  if (!hasSupabase() || cloudSubReady) return
  const sup = getSupabase()
  if (!sup) return
  supabaseRef = sup
  // 1) Realtime subscription for other-device changes.
  cloudChannel = sup
    .channel('myboard-sync-' + BOARD_ROW_ID)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'boards', filter: 'id=eq.' + BOARD_ROW_ID },
      onRow
    )
    .subscribe()
  cloudSubReady = true
  // 2) Pull the latest snapshot once and merge remote-vs-local.
  try {
    const { data } = await sup
      .from('boards')
      .select('payload')
      .eq('id', BOARD_ROW_ID)
      .maybeSingle()
    if (data && data.payload) {
      applyRemote(data.payload)
    }
  } catch (e) {
    console.warn('board sync: initial pull failed', e && e.message)
  }
}

export function initCloud() {
  if (!hasSupabase()) return
  startCloud()
}
