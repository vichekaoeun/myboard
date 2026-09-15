import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Board from './Board.jsx'
import { AuthGate } from './Auth.jsx'
import { Camera } from './camera.js'
import { fanPoses } from './Envelope.jsx'
import { CassetteIcon, PaperClip } from './art.jsx'
import {
  CopyIcon, DownloadIcon, EnvelopeIcon, FileIcon, FitIcon, HelpIcon,
  LinkIcon, MoveIcon, NoteIcon, PinIcon, RedoIcon, SearchIcon, SignOutIcon, UndoIcon, UploadIcon,
  ZoomInIcon, ZoomOutIcon,
} from './icons.jsx'
import * as store from './store.js'
import { apiConfig, apiLoginWithGoogle, apiLogout, apiMe, apiRequestMagicLink } from './api.js'

const TOOLS = [
  { id: 'move', label: 'Move', icon: MoveIcon },
  { id: 'note', label: 'Note', icon: NoteIcon },
  { id: 'pin', label: 'Pin', icon: PinIcon },
  { id: 'envelope', label: 'Envelope', icon: EnvelopeIcon },
  { id: 'link', label: 'Link', icon: LinkIcon },
]

const PAPER_COLORS = [
  { id: 'white', label: 'Cream', swatch: '#fdfaf1' },
  { id: 'yellow', label: 'Canary', swatch: '#fff8c4' },
  { id: 'blue', label: 'Sky', swatch: '#cfe6ff' },
  { id: 'pink', label: 'Rose', swatch: '#ffd6e6' },
  { id: 'green', label: 'Mint', swatch: '#d5f0c8' },
  { id: 'kraft', label: 'Kraft', swatch: '#efe2c8' },
]

export default function App() {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const containerRef = useRef(null)
  const worldLayerRef = useRef(null)
  const cameraRef = useRef(null)
  const hoverRef = useRef(null)
  const [hoverEnvId, setHoverEnvId] = useState(null)
  const [ctx, setCtx] = useState(null)
  const [help, setHelp] = useState(false)
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState('')
  const toastTimer = useRef(null)
  const [showHint, setShowHint] = useState(true)
  const [linkFrom, setLinkFrom] = useState(null)
  const linkFromRef = useRef(null)
  const [flip, setFlip] = useState(0)
  const [locationEditor, setLocationEditor] = useState(null)
  const [musicEditor, setMusicEditor] = useState(null)

  const [session, setSession] = useState(null) // { id, email }
  const [authChecked, setAuthChecked] = useState(false)
  const [boardReady, setBoardReady] = useState(false)
  const loadedUserRef = useRef(null)

  // Resolve the session, then load that account's own board (namespaced local
  // cache + D1 row). Sign-in is required before the board is shown.
  const enter = useCallback(async (user) => {
    if (!user) {
      loadedUserRef.current = null
      setSession(null); setBoardReady(false); setAuthChecked(true)
      store.resetBoard()
      return
    }
    if (user.id === loadedUserRef.current) {
      setSession(user); setBoardReady(true); setAuthChecked(true)
      return
    }
    loadedUserRef.current = user.id
    await store.loadBoard(user.id)
    setSession(user); setBoardReady(true); setAuthChecked(true)
  }, [])

  useEffect(() => {
    let active = true
    apiMe().then((res) => { if (active) enter(res && res.user ? res.user : null) })
    return () => { active = false }
  }, [enter])

  const handleGoogleSignIn = useCallback(async () => {
    apiLoginWithGoogle()
    return null
  }, [])

  const handleEmailSignIn = useCallback(async (email) => {
    const { error } = await apiRequestMagicLink(email)
    return error ? error.message : null
  }, [])

  const handleSignOut = useCallback(async () => {
    await apiLogout()
    enter(null)
  }, [enter])

  const loadProviders = apiConfig

  useLayoutEffect(() => {
    if (!boardReady || !containerRef.current) return
    if (!cameraRef.current) cameraRef.current = new Camera(worldLayerRef.current)
    cameraRef.current.el = worldLayerRef.current
    cameraRef.current.v = { ...store.getState().view }
    cameraRef.current.flush()
    if (typeof window !== 'undefined') { window.__store = store; window.__camera = cameraRef.current }
    // Rescue a stale/off-screen view: if no board content is visible in the
    // restored camera, nudge it to frame the content instead of showing blank cork.
    const st = store.getState()
    if (st.notes.length || st.envelopes.length || st.pins.length) {
      const c = cameraRef.current
      const vw = c.el.clientWidth || window.innerWidth
      const vh = c.el.clientHeight || window.innerHeight
      const wx0 = -c.v.x / c.v.s, wy0 = -c.v.y / c.v.s
      const wx1 = wx0 + vw / c.v.s, wy1 = wy0 + vh / c.v.s
      const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
      const add = (x, y, w, h) => {
        bbox.minX = Math.min(bbox.minX, x); bbox.minY = Math.min(bbox.minY, y)
        bbox.maxX = Math.max(bbox.maxX, x + w); bbox.maxY = Math.max(bbox.maxY, y + h)
      }
      st.notes.forEach((n) => add(n.x, n.y, n.w, n.h))
      st.pins.forEach((p) => add(p.x - 20, p.y - 60, 40, 60))
      st.envelopes.forEach((e) => add(e.x, e.y, e.w, e.h))
      const onScreen = bbox.minX < wx1 && bbox.maxX > wx0 && bbox.minY < wy1 && bbox.maxY > wy0
      const overlapW = Math.min(bbox.maxX, wx1) - Math.max(bbox.minX, wx0)
      const overlapH = Math.min(bbox.maxY, wy1) - Math.max(bbox.minY, wy0)
      // "Small board" rescue: refit not only when content disappeared entirely,
      // but also whenever the frame on screen is small relative to the
      // viewport — a tiny cluster in a corner reads as "the board is small"
      // and never triggers the old fully-off-screen check by itself.
      const tiny = overlapW > 0 && overlapH > 0 && (overlapW < vw * 0.45 || overlapH < vh * 0.45)
      if (bbox.minX !== Infinity && (!onScreen || tiny)) {
        c.fit({ notes: st.notes, pins: st.pins, envelopes: st.envelopes, clips: st.clips, music: st.music })
      }
    }
  }, [boardReady])

  // Seed a friendly first board once per account
  useEffect(() => {
    if (!boardReady) return
    const s = store.getState()
    if (s.notes.length || s.envelopes.length || s.pins.length) return
    const seedFlag = 'myboard.seeded:' + (session?.id || 'local')
    if (localStorage.getItem(seedFlag)) return
    localStorage.setItem(seedFlag, '1')
    const welcome = store.addNote(-430, -150, '<p>Hi, welcome to your board!</p><p>Double-click anywhere (or hit <b>Note</b> above) to drop new notes.</p>', 'white')
    store.addNote(-80, 40, '<p>Drag the <b>red pin</b> up top to move this note.</p><p>Grab the bottom-right corner to resize it.</p><p>Select me to see formatting buttons below.</p>', 'yellow')
    const envelopeNote = store.addNote(120, -260, '<p>Drag this note into the envelope below to collect it with your other letters.</p>', 'blue')
    store.addNote(340, 20, '<p>Type a URL and use the <b>↗</b> button to attach a live link.</p><p>Or paste a picture — it gets saved right here.</p>', 'pink')
    store.addEnvelope(80, 260)
    store.addPin(-560, -40, '#3a7bd5')
    // A sample red string so linking is discoverable (use the Link tool)
    store.addLink(welcome.id, envelopeNote.id)
    // Persist the seed right away so a quick reload can't lose it while the
    // debounced save is still pending.
    store.saveNow()
    // Frame & center the freshly seeded board so it fills the screen
    requestAnimationFrame(() => {
      const st = store.getState()
      cameraRef.current?.fit({ notes: st.notes, pins: st.pins, envelopes: st.envelopes, clips: st.clips, music: st.music })
    })
  }, [boardReady, session])

  // Auto-dismiss the load hint after a few seconds
  useEffect(() => {
    const t = setTimeout(() => setShowHint(false), 6000)
    return () => clearTimeout(t)
  }, [])

  // Leaving link mode drops any half-made connection
  useEffect(() => {
    if (state.mode !== 'link') { linkFromRef.current = null; setLinkFrom(null) }
  }, [state.mode])

  // ---- stable callbacks ------------------------------------------------------

  const getZoom = useCallback(() => (cameraRef.current ? cameraRef.current.v.s : 1), [])

  const handleSelect = useCallback((id) => store.select(id), [])
  const handleNoteChange = useCallback((id, patch) => store.updateNote(id, patch), [])
  const handleNoteLiveHeight = useCallback((id, patch) => store.updateNoteLive(id, patch), [])
  const handleEnvChange = useCallback((id, patch) => store.updateEnvelope(id, patch), [])

  const say = useCallback((msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2400)
  }, [])

  // Two-click linking: pick a note, then the note to tie it to.
  const handleLinkClick = useCallback((id) => {
    const from = linkFromRef.current
    if (!from) {
      linkFromRef.current = id
      setLinkFrom(id)
      say('Now click a note to tie the string to')
      return
    }
    if (from === id) {
      linkFromRef.current = null
      setLinkFrom(null)
      say('Link cancelled')
      return
    }
    const link = store.addLink(from, id)
    linkFromRef.current = null
    setLinkFrom(null)
    say(link ? 'Tied with red string' : 'Those notes are already linked')
  }, [say])

  const envForNote = useMemo(() => {
    const m = {}
    store.getState().envelopes.forEach((e) => e.noteIds.forEach((id) => { m[id] = e.id }))
    return m
  }, [state.envelopes])

  // Red-string connections for the selected note (backlinks + outgoing)
  const connections = useMemo(() => {
    const id = state.selected
    if (!id) return null
    const links = state.links || []
    const byId = new Map(state.notes.map((n) => [n.id, n]))
    const uniq = (arr) => [...new Set(arr)]
    const from = uniq(links.filter((l) => l.to === id).map((l) => l.from)).map((nid) => byId.get(nid)).filter(Boolean)
    const to = uniq(links.filter((l) => l.from === id).map((l) => l.to)).map((nid) => byId.get(nid)).filter(Boolean)
    if (!from.length && !to.length) return null
    return { from, to }
  }, [state.selected, state.links, state.notes])

  const findEnvAt = useCallback(
    (wx, wy) => {
      const pad = 30
      return store.getState().envelopes.find(
        (e) => wx >= e.x - pad && wx <= e.x + e.w + pad && wy >= e.y - pad && wy <= e.y + e.h + pad
      ) || null
    },
    []
  )

  const handleDragMove = useCallback(
    (id, wx, wy) => {
      const n = store.findNote(id)
      const cx = wx + (n ? n.w : 250) / 2
      const cy = wy + (n ? n.h || 260 : 260) / 2
      const env = findEnvAt(cx, cy)
      const envId = env ? env.id : null
      if (envId !== hoverRef.current) {
        hoverRef.current = envId
        setHoverEnvId(envId)
      }
    },
    [findEnvAt]
  )

  const handleMoveEnd = useCallback(
    (id, x, y) => {
      const envId = hoverRef.current
      hoverRef.current = null
      setHoverEnvId(null)
      if (envId) {
        const env = store.findEnvelope(envId)
        store.collectNote(id, envId)
        say(env ? `Collected into “${env.title}”` : 'Collected into envelope')
      } else {
        store.moveNote(id, x, y)
      }
    },
    [say]
  )

  const handleFanDrop = useCallback(
    (id, x, y) => {
      const currentEnv = envForNote[id]
      const envId = hoverRef.current
      hoverRef.current = null
      setHoverEnvId(null)
      if (envId && envId === currentEnv) {
        setFlip(v => v + 1)
        return
      }
      if (envId) {
        store.detachNote(id)
        store.collectNote(id, envId)
        const env = store.findEnvelope(envId)
        say(env ? `Moved into “${env.title}”` : 'Moved into envelope')
      } else {
        store.detachNote(id)
        store.moveNote(id, x, y)
        say('Letter taken out of the envelope')
      }
    },
    [envForNote, say]
  )

  const handleAddNote = useCallback((x, y) => { store.addNote(x, y) }, [])
  const handleAddPin = useCallback((x, y) => {
    const pin = store.addPin(x, y)
    setLocationEditor({ pin, query: '', photo: '' })
  }, [])
  const handleEditLocation = useCallback((pin) => {
    setLocationEditor({ pin, query: pin.location?.query || '', photo: pin.location?.photo || '' })
  }, [])
  const handleResizeLocation = useCallback((id, w, h) => {
    const pin = store.getState().pins.find((item) => item.id === id)
    if (pin) store.updatePin(id, { location: { ...(pin.location || {}), w: Math.round(w), h: Math.round(h) } })
  }, [])
  const saveLocation = useCallback(() => {
    if (!locationEditor) return
    const query = locationEditor.query.trim()
    const photo = locationEditor.photo || ''
    const existing = locationEditor.pin.location || {}
    store.updatePin(locationEditor.pin.id, { location: query || photo ? { ...existing, query, photo } : null })
    setLocationEditor(null)
  }, [locationEditor])
  const handleAddClip = useCallback((url, x, y) => { store.addClip(url, x, y) }, [])
  const handleClipFile = useCallback((e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      const point = cameraRef.current.worldPoint(window.innerWidth / 2, window.innerHeight / 2)
      handleAddClip(reader.result, point.x - 110, point.y - 90)
    }
    reader.readAsDataURL(file)
  }, [handleAddClip])
  const handleMusicFile = useCallback((e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file || !file.type.startsWith('audio/')) return
    const reader = new FileReader()
    reader.onload = () => {
      const point = cameraRef.current.worldPoint(window.innerWidth / 2, window.innerHeight / 2)
      store.addMusic(reader.result, point.x - 160, point.y - 90, file.name.replace(/\.[^.]+$/, ''))
    }
    reader.readAsDataURL(file)
  }, [])
  const handleAddEnvelope = useCallback((x, y) => { store.addEnvelope(x, y) }, [])
  const handleToggleEnvelope = useCallback((id) => store.toggleEnvelope(id), [])
  const handlePinMoveEnd = useCallback((id, x, y) => store.movePin(id, x, y), [])
  const handleClipMoveEnd = useCallback((id, x, y) => store.moveClip(id, x, y), [])
  const handleClipResizeEnd = useCallback((id, w, h) => store.updateClip(id, { w, h }), [])
  const handleMusicMoveEnd = useCallback((id, x, y) => store.moveMusic(id, x, y), [])
  const handleMusicResizeEnd = useCallback((id, w, h) => store.updateMusic(id, { w, h }), [])
  const handleEditMusic = useCallback((music) => {
    setMusicEditor({ music, title: music.title || '', url: music.url })
  }, [])
  const saveMusic = useCallback(() => {
    if (!musicEditor) return
    store.updateMusic(musicEditor.music.id, {
      title: musicEditor.title.trim() || 'Untitled mixtape',
      url: musicEditor.url,
    })
    setMusicEditor(null)
  }, [musicEditor])
  const handleEnvMoveEnd = useCallback((id, x, y) => store.moveEnvelope(id, x, y), [])

  const handleCtxBackground = useCallback((c) => setCtx({ ...c, kind: 'bg' }), [])
  const handleCtxItem = useCallback((e, item, kind) => {
    const p = cameraRef.current.worldPoint(e.clientX, e.clientY)
    setCtx({ x: e.clientX, y: e.clientY, kind, item, wx: p.x, wy: p.y })
  }, [])

  const handleCtxLink = useCallback((e, link) => {
    e.preventDefault()
    e.stopPropagation()
    setCtx({ x: e.clientX, y: e.clientY, kind: 'link', item: link, wx: 0, wy: 0 })
  }, [])

  // ---- keyboard ---------------------------------------------------------------

  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement
      const editing = el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
      if (editing) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redoFn()
        else store.undo()
        return
      }
      const k = e.key
      if (k === 'Delete' || k === 'Backspace') {
        const s = store.getState().selected
        if (s) { e.preventDefault(); store.deleteItem(s) }
        return
      }
      if (k === 'Escape') {
        if (ctx) setCtx(null)
        else if (linkFrom) { linkFromRef.current = null; setLinkFrom(null) }
        else if (store.getState().mode !== 'move') store.setMode('move')
        else if (store.getState().selected) store.select(null)
        return
      }
      if (k === '?') { setHelp(true); return }
      const toolMap = { '1': 'move', '2': 'note', '3': 'pin', '4': 'envelope', '5': 'link', m: 'move', n: 'note', p: 'pin', e: 'envelope', l: 'link' }
      if (toolMap[k]) store.setMode(toolMap[k])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ctx, linkFrom])

  // Clicking anywhere outside the context menu dismisses it
  useEffect(() => {
    if (!ctx) return
    const onPointerDown = (e) => {
      if (e.target && e.target.closest && e.target.closest('.ctxmenu')) return
      setCtx(null)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [ctx])

  // ---- view helpers -----------------------------------------------------------

  const zoomPct = Math.round((state.view?.s || 1) * 100)

  const flash = (id) => {
    const el = document.querySelector(`[data-id="${id}"]`)
    if (!el) return
    el.classList.add('flash')
    setTimeout(() => el.classList.remove('flash'), 1500)
  }

  const focusId = useCallback((id, kind) => {
    const st = store.getState()
    if (kind === 'note') {
      const n = st.notes.find((x) => x.id === id)
      if (!n) return
      const c = cameraRef.current
      c.focusOn(n.x + n.w / 2, n.y + (n.h || 260) / 2, Math.max(n.w, n.h || 260), { onDone: () => flash(id) })
      return
    }
    const env = st.envelopes.find((x) => x.id === id)
    if (!env) return
    let minX = env.x, minY = env.y, maxX = env.x + env.w, maxY = env.y + env.h
    if (env.expanded) {
      const poses = fanPoses(env, env.noteIds, st.notes)
      Object.values(poses).forEach((p) => {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x + 200); maxY = Math.max(maxY, p.y + 200)
      })
    }
    const cxc = (minX + maxX) / 2, cyc = (minY + maxY) / 2
    cameraRef.current.focusOn(cxc, cyc, Math.max(maxX - minX, maxY - minY), { onDone: () => flash(id) })
  }, [])

  const fitView = useCallback(() => {
    const st = store.getState()
    cameraRef.current.fit({ notes: st.notes, pins: st.pins, envelopes: st.envelopes, clips: st.clips, music: st.music })
  }, [])

  // Jump to a linked note (opening its envelope first if it lives inside one)
  const handleOpenLink = useCallback((id) => {
    const envId = envForNote[id]
    if (envId) {
      const env = store.findEnvelope(envId)
      if (env && !env.expanded) store.toggleEnvelope(envId)
      focusId(envId, 'env')
    } else {
      store.select(id)
      focusId(id, 'note')
    }
  }, [envForNote, focusId])

  // ---- search -----------------------------------------------------------------

  const textIndex = useMemo(() => {
    const st = store.getState()
    const map = {}
    const plain = (html) => (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    st.notes.forEach((n) => { map[n.id] = plain(n.text) })
    st.envelopes.forEach((e) => {
      map['env:' + e.id] = e.title + ' ' + e.noteIds.map((id) => map[id] || '').join(' ')
    })
    return map
  }, [state.notes, state.envelopes])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const st = store.getState()
    const out = []
    st.notes.forEach((n) => {
      const txt = textIndex[n.id] || ''
      if (txt.toLowerCase().includes(q)) {
        out.push({ kind: 'note', id: n.id, label: txt.slice(0, 110), inEnv: !!envForNote[n.id], envTitle: st.envelopes.find((e) => e.id === envForNote[n.id])?.title })
      }
    })
    st.envelopes.forEach((e) => {
      const hay = textIndex['env:' + e.id] || ''
      if (hay.toLowerCase().includes(q)) {
        const meetTitle = e.title.toLowerCase().includes(q)
        out.push({ kind: 'env', id: e.id, label: meetTitle ? e.title : `(inside “${e.title}”)`, count: e.noteIds.length })
      }
    })
    return out.slice(0, 40)
  }, [query, textIndex, envForNote, state.notes, state.envelopes])

  const pickResult = (r) => {
    setQuery('')
    if (r.kind === 'note') {
      const envId = envForNote[r.id]
      if (envId) {
        const env = store.findEnvelope(envId)
        if (env && !env.expanded) store.toggleEnvelope(envId)
        focusId(envId, 'env')
      } else {
        focusId(r.id, 'note')
      }
    } else {
      const env = store.findEnvelope(r.id)
      if (env && !env.expanded) store.toggleEnvelope(r.id)
      focusId(r.id, 'env')
    }
  }

  // ---- ctx menu items ---------------------------------------------------------

  const ctxActions = (() => {
    if (!ctx) return []
    const base = []
    if (ctx.kind === 'bg') {
      base.push({ label: 'Add note here', icon: '＋', run: () => store.addNote(ctx.wx, ctx.wy) })
      base.push({ label: 'Add location pin here', icon: '⍟', run: () => handleAddPin(ctx.wx, ctx.wy) })
      base.push({ label: 'Add envelope here', icon: '✉', run: () => store.addEnvelope(ctx.wx, ctx.wy) })
      base.push({ label: 'Fit everything in view', icon: '◱', run: fitView })
    } else if (ctx.kind === 'note') {
      const it = ctx.item
      base.push({ label: 'Duplicate', icon: '❐', run: () => store.duplicateItem(it.id) })
      base.push({ label: 'Take out of envelope', icon: '⌧', run: () => store.detachNote(it.id), show: !!it.groupId })
      base.push({ label: 'Delete note', icon: '×', run: () => store.deleteItem(it.id), danger: true })
    } else if (ctx.kind === 'env') {
      const it = ctx.item
      base.push({ label: it.expanded ? 'Tuck letters back in' : 'Open envelope', icon: '✉', run: () => store.toggleEnvelope(it.id) })
      base.push({ label: 'Duplicate', icon: '❐', run: () => store.duplicateItem(it.id) })
      base.push({ label: 'Delete envelope', icon: '×', run: () => store.deleteItem(it.id), danger: true })
    } else if (ctx.kind === 'pin') {
      base.push({ label: 'Edit location', icon: '⌖', run: () => handleEditLocation(ctx.item) })
      base.push({ label: 'Duplicate', icon: '❐', run: () => store.duplicateItem(ctx.item.id) })
      base.push({ label: 'Delete pin', icon: '×', run: () => store.deleteItem(ctx.item.id), danger: true })
    } else if (ctx.kind === 'clip') {
      base.push({ label: 'Duplicate', icon: '❐', run: () => store.duplicateItem(ctx.item.id) })
      base.push({ label: 'Delete clip', icon: '×', run: () => store.deleteItem(ctx.item.id), danger: true })
    } else if (ctx.kind === 'music') {
      base.push({ label: 'Edit cassette', icon: '✎', run: () => handleEditMusic(ctx.item) })
      base.push({ label: 'Duplicate', icon: '❐', run: () => store.duplicateItem(ctx.item.id) })
      base.push({ label: 'Delete cassette', icon: '×', run: () => store.deleteItem(ctx.item.id), danger: true })
    } else if (ctx.kind === 'link') {
      base.push({ label: 'Remove red string', icon: '✂', run: () => store.removeLink(ctx.item.id), danger: true })
    }
    return base.filter((a) => a.show !== false)
  })()
  void ctxActions

  // ---- export / import --------------------------------------------------------

  const doExport = useCallback(() => {
    const blob = new Blob([store.exportData()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `myboard-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    say('Board exported as JSON')
  }, [say])

  const onImportFile = useCallback(
    (e) => {
      const f = e.target.files && e.target.files[0]
      if (!f) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result)
          store.importState(data)
          if (cameraRef.current) {
            cameraRef.current.v = { ...store.getState().view }
            cameraRef.current.flush()
          }
          say('Board imported')
        } catch (err) {
          say('Could not read that file')
        }
      }
      reader.readAsText(f)
      e.target.value = ''
    },
    [say]
  )

  const copySelected = useCallback(() => {
    const st = store.getState()
    const id = st.selected
    if (!id) return
    store.duplicateItem(id)
    say('Duplicated')
  }, [say])

  // obey no-emoji-ish default but these are handy: keep simple text icons above

  if (!authChecked) {
    return <div className="auth-splash" aria-busy="true" />
  }
  if (!session) {
    return <AuthGate onGoogle={handleGoogleSignIn} onEmail={handleEmailSignIn} loadProviders={loadProviders} />
  }
  if (!boardReady) {
    return <div className="auth-splash" aria-busy="true" />
  }

  return (
    <div className="app">
      <Board
        containerRef={containerRef}
        worldLayerRef={worldLayerRef}
        cameraRef={cameraRef}
        notes={state.notes}
        pins={state.pins}
        clips={state.clips}
        music={state.music}
        envelopes={state.envelopes}
        links={state.links || []}
        connections={connections}
        linkFrom={linkFrom}
        selected={state.selected}
        mode={state.mode}
        tick={flip}
        onSelect={handleSelect}
        onLinkClick={handleLinkClick}
        onOpenLink={handleOpenLink}
        onCtxLink={handleCtxLink}
        onChange={handleNoteChange}
        onLiveHeight={handleNoteLiveHeight}
        onEnvChange={handleEnvChange}
        onMoveEnd={handleMoveEnd}
        onEnvMoveEnd={handleEnvMoveEnd}
        onPinMoveEnd={handlePinMoveEnd}
        onClipMoveEnd={handleClipMoveEnd}
        onClipResizeEnd={handleClipResizeEnd}
        onMusicMoveEnd={handleMusicMoveEnd}
        onMusicResizeEnd={handleMusicResizeEnd}
        onFanDrop={handleFanDrop}
        onDragMove={handleDragMove}
        onAddNote={handleAddNote}
        onAddPin={handleAddPin}
        onAddClip={handleAddClip}
        onAddEnvelope={handleAddEnvelope}
        onToggleEnvelope={handleToggleEnvelope}
        onCtxBackground={handleCtxBackground}
        onCtxItem={handleCtxItem}
        onEditLocation={handleEditLocation}
        onResizeLocation={handleResizeLocation}
        hoverEnvId={hoverEnvId}
        getZoom={getZoom}
      />

      {/* ---------- toolbar ---------- */}
      <div className="tb">
        <div className="tb-brand">
          <span className="tb-logo" /> <span>My Board</span>
        </div>

        <div className="tb-tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`tool-btn ${state.mode === t.id ? 'on' : ''}`}
              onClick={() => store.setMode(t.id)}
              title={toolTitle(t.id)}
            >
              <t.icon size={14} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div className="tb-search">
          <span className="tb-search-icon"><SearchIcon size={14} /></span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => setTimeout(() => setQuery(''), 180)}
            placeholder="Search notes & letters…"
            spellCheck={false}
          />
          {matches.length > 0 && (
            <div className="tb-matches">
              {matches.map((m) => (
                <button key={m.kind + m.id} className="tmatch" onMouseDown={(e) => { e.preventDefault(); pickResult(m) }}>
                  <span className="tmatch-ico">{m.kind === 'note' ? <FileIcon size={15} /> : <EnvelopeIcon size={15} />}</span>
                  <span className="tmatch-label">{m.label}</span>
                  {m.inEnv && <span className="tmatch-env">in “{m.envTitle}”</span>}
                  {m.count != null && <span className="tmatch-env">{m.count}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="tb-zoom">
          <button className="icon-btn" onClick={() => cameraRef.current?.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.25)} title="Zoom out"><ZoomOutIcon size={15} /></button>
          <button className="zoom-read" onClick={fitView} title="Fit everything in view">{zoomPct}%</button>
          <button className="icon-btn" onClick={() => cameraRef.current?.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.25)} title="Zoom in"><ZoomInIcon size={15} /></button>
        </div>

        <div className="tb-actions">
          <button className="icon-btn" onClick={() => store.undo()} title="Undo (Ctrl+Z)"><UndoIcon size={15} /></button>
          <button className="icon-btn" onClick={() => store.redoFn()} title="Redo (Ctrl+Shift+Z)"><RedoIcon size={15} /></button>
          <label className="icon-btn" title="Add image clip">
            <PaperClip size={18} />
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleClipFile} />
          </label>
          <label className="icon-btn" title="Add cassette music">
            <CassetteIcon size={20} />
            <input type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleMusicFile} />
          </label>
          <button className="icon-btn" onClick={copySelected} title="Duplicate selected"><CopyIcon size={15} /></button>
          <button className="icon-btn" onClick={fitView} title="Fit everything"><FitIcon size={15} /></button>
          <button className="icon-btn" onClick={() => setHelp(true)} title="Keyboard shortcuts (?)"><HelpIcon size={15} /></button>
          <button className="icon-btn" onClick={() => { store.saveNow(); doExport() }} title="Export board as JSON"><DownloadIcon size={15} /></button>
          <label className="icon-btn" title="Import board JSON">
            <UploadIcon size={15} />
            <input type="file" accept="application/json" style={{ display: 'none' }} onChange={onImportFile} />
          </label>
        </div>

        {session && (
          <div className="tb-user" title={session.email || 'Signed in'}>
            <span className="tb-user-dot" aria-hidden="true" />
            <span className="tb-user-email">{session.email || 'Signed in'}</span>
            <button className="icon-btn" onClick={handleSignOut} title="Sign out"><SignOutIcon size={15} /></button>
          </div>
        )}
      </div>

      {showHint && <div className="tb-hint">wheel = pan · ctrl+wheel = zoom · drag by a pin to move</div>}

      {locationEditor && (
        <div className="location-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setLocationEditor(null) }}>
          <div className="location-editor">
            <div className="location-editor-head">
              <div>
                <span className="location-kicker">Location pin</span>
                <h2>Attach a place</h2>
              </div>
              <button className="icon-btn" onClick={() => setLocationEditor(null)} title="Close">×</button>
            </div>
            <label className="location-label" htmlFor="location-query">Search for an address or place</label>
            <input
              id="location-query"
              className="location-input"
              autoFocus
              value={locationEditor.query}
              onChange={(e) => setLocationEditor((current) => ({ ...current, query: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') saveLocation() }}
              placeholder="e.g. The Louvre, Paris"
            />
            <label className="location-photo-label" htmlFor="location-photo">Add a photo of this place</label>
            <input
              id="location-photo"
              className="location-photo-input"
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files && e.target.files[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => setLocationEditor((current) => ({ ...current, photo: reader.result }))
                reader.readAsDataURL(file)
              }}
            />
            {locationEditor.photo && (
              <div className="location-photo-preview-wrap">
                <img className="location-photo-preview" src={locationEditor.photo} alt="Location preview" />
                <button type="button" className="location-photo-remove" onClick={() => setLocationEditor((current) => ({ ...current, photo: '' }))}>Remove photo</button>
              </div>
            )}
            {locationEditor.query.trim() ? (
              <iframe
                className="location-preview"
                title="Google Maps preview"
                src={`https://www.google.com/maps?q=${encodeURIComponent(locationEditor.query.trim())}&output=embed`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            ) : (
              <div className="location-empty">Type a place to preview it on Google Maps.</div>
            )}
            <div className="location-actions">
              <button className="location-cancel" onClick={() => setLocationEditor(null)}>Cancel</button>
              <button className="location-save" onClick={saveLocation}>Save location</button>
            </div>
          </div>
        </div>
      )}

      {musicEditor && (
        <div className="location-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setMusicEditor(null) }}>
          <div className="location-editor music-editor">
            <div className="location-editor-head">
              <div>
                <span className="location-kicker">Cassette player</span>
                <h2>Update cassette</h2>
              </div>
              <button className="icon-btn" onClick={() => setMusicEditor(null)} title="Close">×</button>
            </div>
            <label className="location-label" htmlFor="music-title">Cassette title</label>
            <input
              id="music-title"
              className="location-input"
              autoFocus
              value={musicEditor.title}
              onChange={(e) => setMusicEditor((current) => ({ ...current, title: e.target.value }))}
            />
            <label className="location-photo-label" htmlFor="music-file">Replace audio file</label>
            <input
              id="music-file"
              className="location-photo-input"
              type="file"
              accept="audio/*"
              onChange={(e) => {
                const file = e.target.files && e.target.files[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => setMusicEditor((current) => ({ ...current, url: reader.result, title: current.title || file.name.replace(/\.[^.]+$/, '') }))
                reader.readAsDataURL(file)
              }}
            />
            <div className="location-actions">
              <button className="location-cancel" onClick={() => setMusicEditor(null)}>Cancel</button>
              <button className="location-save" onClick={saveMusic}>Save cassette</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- context menu ---------- */}
      {ctx && (
        <div className="ctxmenu" style={{ left: ctx.x, top: ctx.y }}>
          {ctx.kind === 'note' && (
            <div className="ctx-colors" title="Paper colour">
              {PAPER_COLORS.map((c) => (
                <button
                  key={c.id}
                  className={`swatch ${ctx.item.color === c.id ? 'on' : ''}`}
                  style={{ background: c.swatch }}
                  title={c.label}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => { e.stopPropagation(); store.updateNote(ctx.item.id, { color: c.id }); setCtx(null) }}
                />
              ))}
            </div>
          )}
          <div className="ctxmenu-items">
            {(ctxActions.length
              ? ctxActions
              : [{ label: 'No actions', run: () => {} }]
            ).map((a, i) =>
              a.divider ? (
                <div key={i} className="ctx-divider" />
              ) : (
                <button
                  key={a.label}
                  className={`ctxitem ${a.danger ? 'danger' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setCtx(null); a.run() }}
                >
                  <span className="ctx-ico">{a.icon}</span>
                  {a.label}
                </button>
              )
            )}
          </div>
        </div>
      )}

      {/* ---------- toast ---------- */}
      {toast && <div className="toast">{toast}</div>}

      {/* ---------- help ---------- */}
      {help && <HelpDialog onClose={() => setHelp(false)} onFit={fitView} onExport={doExport} />}
    </div>
  )
}

function toolTitle(id) {
  return {
    move: 'Move things around (1) — drag empty board to pan',
    note: 'Click the board to drop a note (2)',
    pin: 'Click the board to drop a location pin (3)',
    envelope: 'Click the board to place an envelope (4)',
    link: 'Link notes with red string (5) — click one note, then another',
  }[id]
}

function HelpDialog({ onClose, onFit, onExport }) {
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h2>My Board — how it works</h2>
        <div className="help-cols">
          <div>
            <h3>Board</h3>
            <ul>
              <li>Wheel / two-finger scroll — <b>pan</b></li>
              <li>Ctrl or Cmd + wheel — <b>zoom</b></li>
              <li>Drag empty cork — <b>pan</b></li>
              <li>Double-click empty board — <b>new note</b></li>
              <li><b>Fit</b> button or “◱” — zoom to everything</li>
            </ul>
          </div>
          <div>
            <h3>Notes &amp; pins</h3>
            <ul>
              <li>Grab a note by its <b>red pin</b> to move it</li>
              <li>Drag the <b>bottom-right corner</b> to resize</li>
              <li>Select a note → <b>B</b>/<i>I</i>/link/image buttons appear</li>
              <li>Click a link to open it; drop/paste images in</li>
              <li>Use the <b>Link</b> tool → click two notes to tie red string</li>
              <li>Right-click any item for colours &amp; more</li>
            </ul>
          </div>
          <div>
            <h3>Envelopes</h3>
            <ul>
              <li><b>Drag a note onto</b> an envelope to collect it</li>
              <li>Drag notes again anywhere else to pop them out</li>
              <li>Click “open” (or double-click) to fan the letters out</li>
            </ul>
          </div>
          <div>
            <h3>Everything</h3>
            <ul>
              <li>Auto-saves to your browser (IndexedDB)</li>
              <li><b>Search</b> finds text inside notes &amp; envelopes</li>
              <li>Undo / redo — Ctrl+Z, Ctrl+Shift+Z</li>
              <li>Delete key removes the selected item</li>
              <li>Export / import — keep a backup file</li>
            </ul>
          </div>
        </div>
        <div className="modal-btns">
          <button onClick={onFit}>Show everything</button>
          <button onClick={onExport}>Export backup</button>
          <button className="primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  )
}