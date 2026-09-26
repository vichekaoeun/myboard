import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Board from './Board.jsx'
import { AuthGate } from './Auth.jsx'
import { Camera } from './camera.js'
import { fanPoses } from './Envelope.jsx'
import { CassetteIcon, PaperClip } from './art.jsx'
import {
  EnvelopeIcon, FileIcon, LinkIcon, MoveIcon, NewspaperIcon, NoteIcon,
  PinIcon, RedoIcon, SearchIcon, SignOutIcon, UndoIcon, ZoomInIcon, ZoomOutIcon,
} from './icons.jsx'
import * as store from './store.js'
import { pointerSelect } from './drag.js'
import { CONNECTION_ORDER, CONNECTION_TYPES } from './connections.js'
import { apiBillingCancel, apiBillingPortal, apiBillingRefresh, apiCheckout, apiConfig, apiLinkPreview, apiLoginWithGoogle, apiLogout, apiMe, apiRequestMagicLink, apiRevokeShare, apiSetShare } from './api.js'

const TOOLS = [
  { id: 'move', label: 'Move', icon: MoveIcon },
  { id: 'note', label: 'Note', icon: NoteIcon },
  { id: 'pin', label: 'Pin', icon: PinIcon },
  { id: 'envelope', label: 'Envelope', icon: EnvelopeIcon },
  { id: 'link', label: 'Link', icon: LinkIcon },
]

const FREE_BOARD_LIMIT = 2

// Stable id for this browser tab, used to identify our own presence entry.
function tabPeerId() {
  try {
    let id = sessionStorage.getItem('myboard.peerId')
    if (!id) {
      id = Math.random().toString(36).slice(2, 10)
      sessionStorage.setItem('myboard.peerId', id)
    }
    return id
  } catch (e) {
    return 'p' + Math.random().toString(36).slice(2, 10)
  }
}
const PEER_ID = tabPeerId()

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2)
  const s = parts.map((w) => (w[0] || '').toUpperCase()).join('')
  return s || '?'
}

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
  const clipInputRef = useRef(null)
  const musicInputRef = useRef(null)
  const importInputRef = useRef(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [boardsOpen, setBoardsOpen] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [shareBoard, setShareBoard] = useState(null)
  const [billing, setBilling] = useState(false)
  const [billingBusy, setBillingBusy] = useState(false)
  const [hoverEnvId, setHoverEnvId] = useState(null)
  const [ctx, setCtx] = useState(null)
  const [help, setHelp] = useState(false)
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState('')
  const toastTimer = useRef(null)
  const [showHint, setShowHint] = useState(true)
  const [linkFrom, setLinkFrom] = useState(null)
  const linkFromRef = useRef(null)
  const [linkType, setLinkType] = useState('related')
  const [flip, setFlip] = useState(0)
  const [locationEditor, setLocationEditor] = useState(null)
  const [musicEditor, setMusicEditor] = useState(null)

  const [session, setSession] = useState(null) // { id, email }
  const [authChecked, setAuthChecked] = useState(false)
  const [boardReady, setBoardReady] = useState(false)
  const loadedUserRef = useRef(null)

  // A shared link (/s/<token>) opens a board without an account. `shared` holds
  // the resolved link; `readonly` is true unless the owner allowed editing.
  const shareToken = useMemo(() => {
    if (typeof window === 'undefined') return null
    const m = window.location.pathname.match(/^\/s\/([^/]+)\/?$/)
    return m ? decodeURIComponent(m[1]) : null
  }, [])
  const [shared, setShared] = useState(null)
  const [shareError, setShareError] = useState('')
  const [guestName, setGuestName] = useState(() => {
    try { return localStorage.getItem('myboard.guestName') || '' } catch (e) { return '' }
  })
  const readonly = !!shared && shared.mode !== 'edit'

  // Resolve the session, then load that account's own board (namespaced local
  // cache + D1 row). Sign-in is required before the board is shown.
  const enter = useCallback(async (user) => {
    if (!user) {
      loadedUserRef.current = null
      // Don't leave a board deep link (/b/<slug>) visible while signed out.
      if (typeof window !== 'undefined' && /^\/b\//.test(window.location.pathname)) {
        window.history.replaceState({}, '', '/')
      }
      setSession(null); setBoardReady(false); setAuthChecked(true)
      store.resetBoard()
      return
    }
    if (user.id === loadedUserRef.current) {
      setSession(user); setBoardReady(true); setAuthChecked(true)
      return
    }
    loadedUserRef.current = user.id
    // Identify ourselves to the board room (display only).
    store.setSelfIdentity({
      id: PEER_ID,
      kind: 'user',
      name: user.name || (user.email ? user.email.split('@')[0] : 'You'),
    })
    // Open the board named in the URL (deep link), if any.
    const m = window.location.pathname.match(/^\/b\/([^/]+)\/?$/)
    const slug = m ? decodeURIComponent(m[1]) : null
    await store.loadBoard(user.id, slug)
    setSession(user); setBoardReady(true); setAuthChecked(true)
  }, [])

  useEffect(() => {
    let active = true
    if (shareToken) {
      // If the owner revokes the link while we're viewing, drop back to a
      // "no longer available" screen instead of leaving the board on screen.
      store.onShareLost(() => {
        setShared(null)
        setBoardReady(false)
        setShareError('This shared board is no longer available.')
      })
      // Free boards allow one guest at a time; the room turns away extras.
      store.onShareFull(() => {
        setShared(null)
        setBoardReady(false)
        setShareError('Someone else is already on this board. The free plan allows one guest at a time — ask the owner to upgrade for unlimited guests.')
      })
      // The owner can flip view↔edit while we're here — apply it live.
      store.onShareChange((meta) => setShared({ mode: meta.mode, name: meta.name }))
      // Identify ourselves to the board room (display only).
      store.setSelfIdentity({ id: PEER_ID, kind: 'guest', name: guestName || '' })
      store.loadShared(shareToken).then((res) => {
        if (!active) return
        if (res && res.error) {
          setShareError(res.error.message || 'This shared board is not available.')
          setAuthChecked(true)
          return
        }
        setShared({ mode: res.mode, name: res.name })
        setAuthChecked(true)
        setBoardReady(true)
      })
      return () => { active = false }
    }
    apiMe().then((res) => { if (active) enter(res && res.user ? res.user : null) })
    return () => { active = false }
  }, [enter, shareToken])

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

  // Is billing (Stripe) configured on the server?
  useEffect(() => {
    apiConfig().then((c) => { if (c && !c.error) setBilling(!!c.billing) })
  }, [])

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
        c.fit({ notes: st.notes, pins: st.pins, envelopes: st.envelopes, clips: st.clips, music: st.music, cards: st.cards })
      }
    }
  }, [boardReady, state.boardId])

  // Seed a friendly first board once per account
  useEffect(() => {
    if (!boardReady || shared) return
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
      cameraRef.current?.fit({ notes: st.notes, pins: st.pins, envelopes: st.envelopes, clips: st.clips, music: st.music, cards: st.cards })
    })
  }, [boardReady, session, shared])

  // Auto-dismiss the load hint after a few seconds
  useEffect(() => {
    const t = setTimeout(() => setShowHint(false), 6000)
    return () => clearTimeout(t)
  }, [])

  // Leaving link mode drops any half-made connection
  useEffect(() => {
    if (state.mode !== 'link') { linkFromRef.current = null; setLinkFrom(null) }
  }, [state.mode])

  // Keep the address bar in sync with the open board, so /b/<slug> is a real
  // deep link you can bookmark or share.
  useEffect(() => {
    if (shared || !boardReady || !state.boardSlug) return
    const want = '/b/' + state.boardSlug
    if (window.location.pathname !== want) window.history.replaceState({}, '', want)
  }, [state.boardSlug, shared, boardReady])

  // A shared board switching to view-only mid-edit: close the open editor,
  // format bar and menus so nothing stays editable.
  useEffect(() => {
    if (!readonly) return
    store.clearSelection()
    setCtx(null)
    setLocationEditor(null)
    setMusicEditor(null)
    const el = typeof document !== 'undefined' ? document.activeElement : null
    if (el && el.blur) el.blur()
  }, [readonly])

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

  // "Guest 2 is editing" style notices from other people on the board.
  useEffect(() => {
    store.onActivity((msg) => {
      const verb = msg.what === 'edited' ? 'is editing' : msg.what
      say(`${msg.peer.name} ${verb}`)
    })
  }, [say])

  const handleUpgrade = useCallback(async (interval) => {
    setBillingBusy(true)
    const res = await apiCheckout(interval)
    setBillingBusy(false)
    if (res && res.url) { window.location.assign(res.url); return }
    say((res && res.error && res.error.message) || 'Could not start checkout')
  }, [say])

  const handleManage = useCallback(async () => {
    const res = await apiBillingPortal()
    if (res && res.url) { window.location.assign(res.url); return }
    say((res && res.error && res.error.message) || 'Could not open billing')
  }, [say])

  const handleSwitch = useCallback(async () => {
    // Plan changes (monthly <-> annual) are handled in Stripe's Billing Portal,
    // where the customer sees the prorated amount and pays/confirms.
    await handleManage()
  }, [handleManage])

  const handleCancel = useCallback(async (resume) => {
    setBillingBusy(true)
    const res = await apiBillingCancel(resume)
    setBillingBusy(false)
    if (res && !res.error) {
      setSession((s) => (s ? { ...s, ...res } : s))
      say(resume ? 'Plan resumed' : 'Plan will cancel at the end of the period')
    } else {
      say((res && res.error && res.error.message) || 'Could not update plan')
    }
  }, [say])

  // Returning from Stripe Checkout: sync the plan, then clean the URL.
  useEffect(() => {
    if (!authChecked || shareToken) return
    const params = new URLSearchParams(window.location.search)
    const b = params.get('billing')
    if (!b) return
    params.delete('billing')
    const qs = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : ''))
    if (b === 'success') {
      apiBillingRefresh()
        .then(() => apiMe())
        .then((res) => {
          if (res && res.user) {
            setSession(res.user)
            if (res.user.plan === 'pro') say('Welcome to Pro!')
          }
        })
    } else if (b === 'cancel') {
      say('Upgrade cancelled')
    } else if (b === 'portal') {
      // Returned from Stripe's Billing Portal (plan change/cancel) — resync.
      apiBillingRefresh()
        .then(() => apiMe())
        .then((res) => { if (res && res.user) setSession(res.user) })
    }
  }, [authChecked, shareToken, say])

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
    const link = store.addLink(from, id, linkType)
    linkFromRef.current = null
    setLinkFrom(null)
    const t = CONNECTION_TYPES[linkType] || CONNECTION_TYPES.related
    say(link ? `Tied a “${t.label}” string` : 'Those notes are already linked')
  }, [say, linkType])

  const envForNote = useMemo(() => {
    const m = {}
    store.getState().envelopes.forEach((e) => e.noteIds.forEach((id) => { m[id] = e.id }))
    return m
  }, [state.envelopes])

  // Red-string connections for the selected note (backlinks + outgoing),
  // each carrying its link so the panel can show the relationship type/label.
  const connections = useMemo(() => {
    const id = state.selected
    if (!id) return null
    const links = state.links || []
    const byId = new Map(state.notes.map((n) => [n.id, n]))
    const uniq = (arr) => [...new Set(arr)]
    const pairs = (match, pick) => uniq(links.filter(match).map(pick)).map((nid) => ({
      note: byId.get(nid),
      link: links.find((l) => match(l) && pick(l) === nid),
    })).filter((x) => x.note)
    const from = pairs((l) => l.to === id, (l) => l.from)
    const to = pairs((l) => l.from === id, (l) => l.to)
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

  // ---- saved link cards -------------------------------------------------------

  const handleCardMoveEnd = useCallback((id, x, y) => store.moveCard(id, x, y), [])
  const handleCardResizeEnd = useCallback((id, w, h) => store.updateCard(id, { w, h }), [])
  const handleOpenCard = useCallback((card) => {
    if (card && card.url) window.open(card.url, '_blank', 'noopener')
  }, [])

  const normalizeUrl = (raw) => {
    let url = String(raw || '').trim()
    if (!url) return null
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
      url = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url) ? `mailto:${url}` : `https://${url}`
    }
    try {
      const u = new URL(url)
      if (!['http:', 'https:'].includes(u.protocol)) return null
      return u.href
    } catch (e) {
      return null
    }
  }

  const handleAddCard = useCallback(async () => {
    const href = normalizeUrl(window.prompt('Paste a link to save as a card (https://…)'))
    if (!href) { say('That doesn’t look like a valid link'); return }
    say('Fetching preview…')
    const point = cameraRef.current
      ? cameraRef.current.worldPoint(window.innerWidth / 2, window.innerHeight / 2)
      : { x: 0, y: 0 }
    const res = await apiLinkPreview(href)
    const preview = res && !res.error
      ? res
      : { url: href, title: '', description: '', image: '', favicon: '', siteName: '' }
    if (res && res.error) say(res.error)
    store.addCard(Math.round(point.x - 150), Math.round(point.y - 150), preview)
  }, [say])

  const refreshCard = useCallback(async (card) => {
    say('Refreshing preview…')
    const res = await apiLinkPreview(card.url)
    if (res && res.error) { say(res.error); return }
    store.updateCard(card.id, {
      url: res.url, title: res.title, description: res.description,
      image: res.image, favicon: res.favicon, siteName: res.siteName,
    })
  }, [say])

  const handleCtxBackground = useCallback((c) => { if (!readonly) setCtx({ ...c, kind: 'bg' }) }, [readonly])
  const handleCtxItem = useCallback((e, item, kind) => {
    if (readonly) return
    const p = cameraRef.current.worldPoint(e.clientX, e.clientY)
    // Right-clicking an item outside the current selection selects just it, so
    // the menu has a clear target (and acts on the selection when there is one).
    const ids = store.getState().selectedIds || []
    if (item && !ids.includes(item.id)) store.select(item.id)
    setCtx({ x: e.clientX, y: e.clientY, kind, item, wx: p.x, wy: p.y })
  }, [readonly])

  const handleCtxLink = useCallback((e, link) => {
    e.preventDefault()
    e.stopPropagation()
    if (readonly) return
    setCtx({ x: e.clientX, y: e.clientY, kind: 'link', item: link, wx: 0, wy: 0 })
  }, [readonly])

  // ---- keyboard shortcuts are wired up after the callbacks below ----

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

  // Close the toolbar "more" menu when clicking elsewhere
  useEffect(() => {
    if (!moreOpen) return
    const onPointerDown = (e) => {
      if (e.target && e.target.closest && e.target.closest('.tb-more')) return
      setMoreOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [moreOpen])

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
    cameraRef.current.fit({ notes: st.notes, pins: st.pins, envelopes: st.envelopes, clips: st.clips, music: st.music, cards: st.cards })
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

  const batchDuplicate = (id) => {
    const ids = store.getState().selectedIds || []
    if (ids.length > 1 && ids.includes(id)) store.duplicateSelection()
    else store.duplicateItem(id)
  }
  const batchDelete = (id) => {
    const ids = store.getState().selectedIds || []
    if (ids.length > 1 && ids.includes(id)) store.deleteSelection()
    else store.deleteItem(id)
  }
  const batchFront = (id) => {
    const ids = store.getState().selectedIds || []
    store.bringToFront(ids.length > 1 && ids.includes(id) ? ids : [id])
  }
  const batchBack = (id) => {
    const ids = store.getState().selectedIds || []
    store.sendToBack(ids.length > 1 && ids.includes(id) ? ids : [id])
  }

  const ctxActions = (() => {
    if (!ctx) return []
    const base = []
    const selCount = (store.getState().selectedIds || []).length
    const multi = selCount > 1
    const dupLabel = multi ? `Duplicate ${selCount} items` : 'Duplicate'
    const delLabel = (one) => (multi ? `Delete ${selCount} items` : one)
    if (ctx.kind === 'bg') {
      base.push({ label: 'Add note here', icon: '＋', run: () => store.addNote(ctx.wx, ctx.wy) })
      base.push({ label: 'Add location pin here', icon: '⍟', run: () => handleAddPin(ctx.wx, ctx.wy) })
      base.push({ label: 'Add envelope here', icon: '✉', run: () => store.addEnvelope(ctx.wx, ctx.wy) })
      base.push({ label: 'Fit everything in view', icon: '◱', run: fitView })
    } else if (ctx.kind === 'note') {
      const it = ctx.item
      base.push({ label: dupLabel, icon: '❐', run: () => batchDuplicate(it.id) })
      base.push({ label: 'Take out of envelope', icon: '⌧', run: () => store.detachNote(it.id), show: !!it.groupId })
      base.push({ label: delLabel('Delete note'), icon: '×', run: () => batchDelete(it.id), danger: true })
    } else if (ctx.kind === 'env') {
      const it = ctx.item
      base.push({ label: it.expanded ? 'Tuck letters back in' : 'Open envelope', icon: '✉', run: () => store.toggleEnvelope(it.id) })
      base.push({ label: dupLabel, icon: '❐', run: () => batchDuplicate(it.id) })
      base.push({ label: delLabel('Delete envelope'), icon: '×', run: () => batchDelete(it.id), danger: true })
    } else if (ctx.kind === 'pin') {
      base.push({ label: 'Edit location', icon: '⌖', run: () => handleEditLocation(ctx.item) })
      base.push({ label: dupLabel, icon: '❐', run: () => batchDuplicate(ctx.item.id) })
      base.push({ label: delLabel('Delete pin'), icon: '×', run: () => batchDelete(ctx.item.id), danger: true })
    } else if (ctx.kind === 'clip') {
      base.push({ label: dupLabel, icon: '❐', run: () => batchDuplicate(ctx.item.id) })
      base.push({ label: delLabel('Delete clip'), icon: '×', run: () => batchDelete(ctx.item.id), danger: true })
    } else if (ctx.kind === 'music') {
      base.push({ label: 'Edit cassette', icon: '✎', run: () => handleEditMusic(ctx.item) })
      base.push({ label: dupLabel, icon: '❐', run: () => batchDuplicate(ctx.item.id) })
      base.push({ label: delLabel('Delete cassette'), icon: '×', run: () => batchDelete(ctx.item.id), danger: true })
    } else if (ctx.kind === 'link') {
      const it = ctx.item
      base.push({ label: 'Edit label…', icon: '✎', run: () => {
        const v = window.prompt('Label for this connection', it.label || '')
        if (v != null) store.updateLink(it.id, { label: v.trim() })
      } })
      base.push({ label: 'Reverse direction', icon: '⇄', run: () => store.reverseLink(it.id) })
      base.push({ label: 'Remove string', icon: '✂', run: () => store.removeLink(it.id), danger: true })
    } else if (ctx.kind === 'card') {
      const it = ctx.item
      base.push({ label: 'Open link', icon: '↗', run: () => handleOpenCard(it) })
      base.push({ label: 'Copy link', icon: '⧉', run: () => { if (navigator.clipboard) navigator.clipboard.writeText(it.url); say('Link copied') } })
      base.push({ label: 'Refresh preview', icon: '⟳', run: () => refreshCard(it) })
      base.push({ label: dupLabel, icon: '❐', run: () => batchDuplicate(it.id) })
      base.push({ label: delLabel('Delete card'), icon: '×', run: () => batchDelete(it.id), danger: true })
    }
    if (ctx.kind !== 'bg' && ctx.kind !== 'link') {
      const it = ctx.item
      base.push({ divider: true })
      base.push({ label: 'Bring to front', icon: '↑', run: () => batchFront(it.id) })
      base.push({ label: 'Send to back', icon: '↓', run: () => batchBack(it.id) })
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
    if (!(st.selectedIds || []).length && !st.selected) return
    store.duplicateSelection()
    say('Duplicated')
  }, [say])

  // ---- boards -----------------------------------------------------------------

  const openBoardById = useCallback((id) => { setBoardsOpen(false); store.openBoard(id) }, [])
  const newBoard = useCallback(() => {
    const plan = session?.plan || 'free'
    if (plan !== 'pro' && store.getState().boards.length >= FREE_BOARD_LIMIT) {
      setUpgradeOpen(true)
      return
    }
    const v = window.prompt('Board name', 'New board')
    if (v == null) return // cancelled — don't create
    const res = store.createBoard(v.trim() || 'New board')
    return Promise.resolve(res).then((r) => {
      if (r && r.error) {
        if (r.error.code === 'board_limit') setUpgradeOpen(true)
        else say(r.error.message || 'Could not create board')
      }
    })
  }, [session, say])
  const renameBoardById = useCallback((id, name) => store.renameBoard(id, name), [])
  const deleteBoardById = useCallback((id) => store.deleteBoard(id), [])

  // ---- keyboard ---------------------------------------------------------------

  useEffect(() => {
    const onKey = (e) => {
      // Read-only shared boards accept no editing shortcuts (zoom still works
      // via the on-screen controls).
      if (readonly) return
      const el = document.activeElement
      const editing = el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
      if (editing) {
        // While typing, Delete only removes a multi-selection; otherwise it's a
        // normal text delete. Cmd/Ctrl + ] / [ reorder without typing a char.
        if (e.key === 'Delete' || e.key === 'Backspace') {
          const st = store.getState()
          if ((st.selectedIds || []).length > 1) { e.preventDefault(); store.deleteSelection() }
        } else if ((e.metaKey || e.ctrlKey) && (e.key === ']' || e.key === '[')) {
          e.preventDefault()
          if (e.key === ']') store.bringToFront()
          else store.sendToBack()
        }
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redoFn()
        else store.undo()
        return
      }
      const k = e.key
      if (k === 'Escape') {
        if (ctx) setCtx(null)
        else if (shareBoard) setShareBoard(null)
        else if (boardsOpen) setBoardsOpen(false)
        else if (upgradeOpen) setUpgradeOpen(false)
        else if (moreOpen) setMoreOpen(false)
        else if (linkFrom) { linkFromRef.current = null; setLinkFrom(null) }
        else if (store.getState().mode !== 'move') store.setMode('move')
        else if (store.getState().selected) store.select(null)
        return
      }
      if (k === 'Delete' || k === 'Backspace') {
        const st = store.getState()
        if ((st.selectedIds || []).length || st.selected) { e.preventDefault(); store.deleteSelection() }
        return
      }
      if (k === '?') { setHelp(true); return }
      // Single-key shortcuts never fire with a modifier held.
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const key = k.toLowerCase()
      if (key === 'i') { clipInputRef.current?.click(); return }
      if (key === 'a') { musicInputRef.current?.click(); return }
      if (key === 'c') { handleAddCard(); return }
      if (key === 'd') { copySelected(); return }
      if (key === 'f') { fitView(); return }
      if (key === ']') { store.bringToFront(); return }
      if (key === '[') { store.sendToBack(); return }
      const toolMap = { '1': 'move', '2': 'note', '3': 'pin', '4': 'envelope', '5': 'link', m: 'move', n: 'note', p: 'pin', e: 'envelope', l: 'link' }
      if (toolMap[key]) store.setMode(toolMap[key])
    }
    // Capture phase so shortcuts still work when a note editor (which stops
    // propagation on keydown) has focus.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [ctx, linkFrom, moreOpen, boardsOpen, upgradeOpen, shareBoard, handleAddCard, copySelected, fitView, readonly])

  // obey no-emoji-ish default but these are handy: keep simple text icons above

  if (!authChecked) {
    return <div className="auth-splash" aria-busy="true" />
  }
  if (shareError) {
    return <ShareErrorView message={shareError} />
  }
  if (!shared && !session) {
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
        cards={state.cards || []}
        envelopes={state.envelopes}
        links={state.links || []}
        connections={connections}
        linkFrom={linkFrom}
        selected={state.selected}
        selectedIds={state.selectedIds || []}
        mode={state.mode}
        tick={flip}
        onSelect={handleSelect}
        onPointerSelect={pointerSelect}
        onSelectMany={store.selectMany}
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
        onCardMoveEnd={handleCardMoveEnd}
        onCardResizeEnd={handleCardResizeEnd}
        onOpenCard={handleOpenCard}
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
        readonly={readonly}
        cursors={state.cursors || {}}
        onReportCursor={store.reportCursor}
      />

      {/* ---------- toolbar ---------- */}
      {!readonly && (
      <div className="tb">
        <div className="tb-brand">
          <span className="tb-logo" /> <span>SimpleBoard</span>
        </div>

        {!shared && (
        <div className="tb-boards">
          <button className={`tb-board-btn ${boardsOpen ? 'on' : ''}`} onClick={() => setBoardsOpen(true)} title="Browse boards">
            <span className="tb-board-name">{state.boardName || 'Board'}</span>
            <span className="tb-caret" aria-hidden="true">▾</span>
          </button>
        </div>
        )}

        <div className="tb-tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`tool-btn ${state.mode === t.id ? 'on' : ''}`}
              onClick={() => store.setMode(t.id)}
              title={toolTitle(t.id)}
            >
              <t.icon size={15} />
            </button>
          ))}
          <span className="tb-div" />
          <button className="tool-btn" onClick={() => clipInputRef.current?.click()} title="Add image (I)">
            <PaperClip size={18} />
          </button>
          <button className="tool-btn" onClick={() => musicInputRef.current?.click()} title="Add audio (A)">
            <CassetteIcon size={20} />
          </button>
          <button className="tool-btn" onClick={handleAddCard} title="Save a link card (C)">
            <NewspaperIcon size={16} />
          </button>
        </div>

        {state.mode === 'link' && (
          <div className="tb-links" role="group" aria-label="Connection type">
            {CONNECTION_ORDER.map((tid) => {
              const t = CONNECTION_TYPES[tid]
              return (
                <button
                  key={tid}
                  type="button"
                  className={`tb-link-type ${linkType === tid ? 'on' : ''}`}
                  style={{ '--dot': t.color }}
                  onClick={() => setLinkType(tid)}
                  title={`${t.label} connections`}
                >
                  <span className="tb-link-dot" style={{ background: t.color }} />
                  <span className="tb-link-name">{t.label}</span>
                </button>
              )
            })}
          </div>
        )}

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
          <div className="tb-more">
            <button
              className={`icon-btn ${moreOpen ? 'on' : ''}`}
              onClick={() => setMoreOpen((v) => !v)}
              title="More actions"
            >
              <span className="tb-more-dots" aria-hidden="true">⋯</span>
            </button>
            {moreOpen && (
              <div className="tb-menu" onPointerDown={(e) => e.stopPropagation()}>
                <button className="tb-menu-item" onClick={() => { setMoreOpen(false); store.bringToFront() }}>Bring to front<span className="tb-kbd">]</span></button>
                <button className="tb-menu-item" onClick={() => { setMoreOpen(false); store.sendToBack() }}>Send to back<span className="tb-kbd">[</span></button>
                <div className="tb-menu-div" />
                <button className="tb-menu-item" onClick={() => { setMoreOpen(false); copySelected() }}>Duplicate<span className="tb-kbd">D</span></button>
                <button className="tb-menu-item" onClick={() => { setMoreOpen(false); fitView() }}>Fit everything<span className="tb-kbd">F</span></button>
                <button className="tb-menu-item" onClick={() => { setMoreOpen(false); setHelp(true) }}>Shortcuts &amp; help<span className="tb-kbd">?</span></button>
                <div className="tb-menu-div" />
                <button className="tb-menu-item" onClick={() => { setMoreOpen(false); setUpgradeOpen(true) }}>Plan &amp; billing</button>
                <button className="tb-menu-item" onClick={() => { setMoreOpen(false); store.saveNow(); doExport() }}>Export board</button>
                <button className="tb-menu-item" onClick={() => { setMoreOpen(false); importInputRef.current?.click() }}>Import board</button>
              </div>
            )}
          </div>
          {session && !shared && (
            <button className="icon-btn" onClick={handleSignOut} title="Sign out"><SignOutIcon size={15} /></button>
          )}
        </div>

        <input ref={clipInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleClipFile} />
        <input ref={musicInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleMusicFile} />
        <input ref={importInputRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={onImportFile} />
      </div>
      )}

      {shared && (
        <div className="share-bar">
          <span className="share-logo" />
          <span className="share-name">{state.boardName || 'Shared board'}</span>
          <span className={`share-mode ${readonly ? '' : 'edit'}`}>{readonly ? 'View only' : 'Editing'}</span>
          {!readonly && (
            <label className="share-as">
              <span>as</span>
              <input
                value={guestName}
                onChange={(e) => {
                  const v = e.target.value.slice(0, 40)
                  setGuestName(v)
                  try { localStorage.setItem('myboard.guestName', v) } catch (err) {}
                }}
                onBlur={() => store.setSelfIdentity({ name: guestName.trim() })}
                placeholder="Your name"
                spellCheck={false}
              />
            </label>
          )}
          {readonly && (
            <span className="share-zoom">
              <button className="icon-btn" onClick={() => cameraRef.current?.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.25)} title="Zoom out"><ZoomOutIcon size={15} /></button>
              <button className="zoom-read" onClick={fitView} title="Fit everything in view">{zoomPct}%</button>
              <button className="icon-btn" onClick={() => cameraRef.current?.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.25)} title="Zoom in"><ZoomInIcon size={15} /></button>
            </span>
          )}
        </div>
      )}

      {state.peers && state.peers.some((p) => p.id !== PEER_ID) && (
        <div className="presence-bar" aria-label="People on this board">
          {state.peers.filter((p) => p.id !== PEER_ID).map((p) => {
            const live = state.cursors && state.cursors[p.id] && state.cursors[p.id].editing
            return (
              <span
                key={p.id}
                className={`peer-chip ${live ? 'editing' : ''}`}
                style={{ '--c': p.color || '#8a7a63' }}
                title={live ? `${p.name} is editing` : p.name}
              >
                <span className="peer-avatar" style={{ background: p.color || '#8a7a63' }}>{initials(p.name)}</span>
                <span className="peer-label">{p.name}</span>
                {live && <span className="peer-editing">editing</span>}
              </span>
            )
          })}
        </div>
      )}

      {showHint && <div className="tb-hint">drag = select · wheel = pan · ctrl+wheel = zoom</div>}

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
          {ctx.kind === 'link' && (
            <div className="ctx-colors" title="Connection type">
              {CONNECTION_ORDER.map((tid) => {
                const t = CONNECTION_TYPES[tid]
                return (
                  <button
                    key={tid}
                    className={`swatch ${(ctx.item.type || 'related') === tid ? 'on' : ''}`}
                    style={{ background: t.color }}
                    title={t.label}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => { e.stopPropagation(); store.updateLink(ctx.item.id, { type: tid }); setCtx(null) }}
                  />
                )
              })}
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
      {boardsOpen && (
        <BoardsDialog
          boards={state.boards}
          currentId={state.boardId}
          plan={session?.plan || 'free'}
          onOpen={openBoardById}
          onNew={newBoard}
          onRename={renameBoardById}
          onDelete={deleteBoardById}
          onPlan={() => { setBoardsOpen(false); setUpgradeOpen(true) }}
          onShare={(b) => { setBoardsOpen(false); setShareBoard(b) }}
          onClose={() => setBoardsOpen(false)}
        />
      )}

      {upgradeOpen && (
        <PlanDialog
          session={session}
          billing={billing}
          busy={billingBusy}
          onBuy={handleUpgrade}
          onSwitch={handleSwitch}
          onCancel={handleCancel}
          onManage={handleManage}
          onClose={() => setUpgradeOpen(false)}
        />
      )}

      {shareBoard && (
        <ShareDialog
          board={shareBoard}
          plan={session?.plan || 'free'}
          onUpgrade={() => { setShareBoard(null); setUpgradeOpen(true) }}
          onClose={() => setShareBoard(null)}
        />
      )}

      {help && <HelpDialog onClose={() => setHelp(false)} onFit={fitView} onExport={doExport} />}
    </div>
  )
}

function toolTitle(id) {
  return {
    move: 'Move (1 / M) — drag empty board to pan',
    note: 'Note (2 / N) — click the board to drop one',
    pin: 'Pin (3 / P) — click the board to drop a location',
    envelope: 'Envelope (4 / E) — click the board to place one',
    link: 'Link (5 / L) — pick a type, then click two notes',
  }[id]
}

function HelpDialog({ onClose, onFit, onExport }) {
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h2>SimpleBoard — how it works</h2>
        <div className="help-cols">
          <div>
            <h3>Board</h3>
            <ul>
              <li>Wheel / two-finger scroll — <b>pan</b></li>
              <li>Space or middle-drag — <b>pan</b></li>
              <li>Ctrl or Cmd + wheel — <b>zoom</b></li>
              <li>Drag empty cork — <b>marquee select</b></li>
              <li>Ctrl/Cmd + click items — <b>multi-select</b></li>
              <li>Drag any selected item — moves the <b>whole selection</b></li>
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
              <li>Use the <b>Link</b> tool → pick a type, click two notes to tie a string</li>
              <li>Save a link as an <b>article card</b> from the toolbar</li>
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
          <div>
            <h3>Shortcuts</h3>
            <ul>
              <li><b>1–5</b> (or <b>M N P E L</b>) — tools</li>
              <li><b>I</b> image · <b>A</b> audio · <b>C</b> link card</li>
              <li><b>D</b> duplicate · <b>F</b> fit · <b>?</b> help</li>
              <li><b>]</b> bring to front · <b>[</b> send to back (add Ctrl/Cmd while typing)</li>
              <li><b>Ctrl/Cmd+Z</b> undo · add <b>Shift</b> to redo</li>
              <li><b>Delete</b> removes selected · <b>Esc</b> cancels</li>
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

function boardCover(id) {
  let h = 0
  const s = String(id || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return `linear-gradient(135deg, hsl(${h} 42% 70%), hsl(${(h + 28) % 360} 40% 54%))`
}

function relTime(t) {
  if (!t) return '—'
  const d = Date.now() - t
  if (d < 60000) return 'just now'
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`
  if (d < 7 * 86400000) return `${Math.floor(d / 86400000)}d ago`
  return new Date(t).toLocaleDateString()
}

function BoardsDialog({ boards, currentId, plan, onOpen, onNew, onRename, onDelete, onPlan, onShare, onClose }) {
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState('')
  const needle = q.trim().toLowerCase()
  const filtered = boards.filter((b) => b.name.toLowerCase().includes(needle))
  const isPro = plan === 'pro'

  const commit = (b) => {
    const v = draft.trim()
    if (v && v !== b.name) onRename(b.id, v)
    setEditing(null)
  }

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal boards-modal">
        <div className="boards-head">
          <h2>Your boards</h2>
          <div className="boards-tools">
            <input
              className="boards-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search boards…"
              spellCheck={false}
            />
            {!isPro && <button className="boards-upgrade" onClick={onPlan}>Upgrade</button>}
            <button className="boards-new-btn" onClick={onNew}>＋ New board</button>
            <button className="icon-btn" onClick={onClose} title="Close">×</button>
          </div>
        </div>

        <div className="boards-planline">
          <button className={`plan-chip ${isPro ? 'pro' : ''}`} onClick={onPlan} title="Plan & billing">{isPro ? 'Pro' : 'Free plan'}</button>
          <span className="boards-plannote">
            {isPro
              ? 'Unlimited boards, history, media and collaboration.'
              : `${boards.length} of ${FREE_BOARD_LIMIT} boards used`}
          </span>
          <button className="boards-upgrade" onClick={onPlan}>{isPro ? 'Manage plan' : 'Upgrade'}</button>
        </div>

        <div className="boards-grid">
          {filtered.map((b) => (
            <div key={b.id} className={`board-card ${b.id === currentId ? 'on' : ''}`}>
              <button
                className="board-cover"
                style={{ background: boardCover(b.id) }}
                onClick={() => onOpen(b.id)}
                aria-label={`Open ${b.name}`}
              />
              <div className="board-card-row">
                {editing === b.id ? (
                  <input
                    className="board-name-input"
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commit(b)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commit(b) }
                      else if (e.key === 'Escape') { e.stopPropagation(); setEditing(null) }
                    }}
                  />
                ) : (
                  <button className="board-card-name" onClick={() => onOpen(b.id)}>{b.name}</button>
                )}
                <div className="board-card-actions">
                  <button title="Share" onClick={(e) => { e.stopPropagation(); onShare(b) }}>⧉</button>
                  <button title="Rename" onClick={(e) => { e.stopPropagation(); setEditing(b.id); setDraft(b.name) }}>✎</button>
                  <button
                    title="Delete"
                    onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete “${b.name}”?`)) onDelete(b.id) }}
                  >×</button>
                </div>
              </div>
              <div className="board-card-meta">
                Edited {relTime(b.updatedAt)}
                {b.shareToken && <span className="board-shared" title="Shared via link">· Shared</span>}
              </div>
            </div>
          ))}

          <button className="board-card board-card-new" onClick={onNew}>
            <span className="board-new-plus" aria-hidden="true">＋</span>
            <span>New board</span>
          </button>
        </div>

        {filtered.length === 0 && <div className="boards-empty">No boards match “{q}”.</div>}
      </div>
    </div>
  )
}

function PlanDialog({ session, billing, busy, onBuy, onSwitch, onCancel, onManage, onClose }) {
  const isPro = (session?.plan || 'free') === 'pro'
  const interval = session?.planInterval
  const renews = session?.planRenewsAt
  const canceling = !!session?.cancelAtPeriodEnd
  const status = session?.subscriptionStatus
  const dateStr = renews ? new Date(renews).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal upgrade-modal">
        <h2>Plan &amp; billing</h2>

        <div className="plan-status">
          <span className={`plan-chip ${isPro ? 'pro' : ''}`}>{isPro ? 'Pro' : 'Free plan'}</span>
          <span className="plan-status-note">
            {isPro
              ? (canceling ? `Cancels on ${dateStr}` : (renews ? `Renews ${dateStr}` : 'Active'))
              : '2 boards · 1 guest at a time'}
          </span>
          {isPro && status && status !== 'active' && <span className="plan-status-note">· {status}</span>}
        </div>

        {isPro ? (
          <>
            <div className="plan-actions">
              {interval === 'month' && (
                <button className="primary" onClick={onSwitch}>Switch to annual · $24/yr</button>
              )}
              {interval === 'year' && (
                <button className="primary" onClick={onSwitch}>Switch to monthly · $3/mo</button>
              )}
              <button onClick={onManage}>Manage billing &amp; invoices</button>
              {canceling ? (
                <button disabled={busy} onClick={() => onCancel(true)}>Resume plan</button>
              ) : (
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => { if (window.confirm('Cancel Pro at the end of the current billing period?')) onCancel(false) }}
                >
                  Cancel plan
                </button>
              )}
            </div>
            <p className="plan-note">Plan changes open Stripe, where you’ll see the prorated amount before paying.</p>
          </>
        ) : (
          <>
            <ul className="upgrade-list">
              <li><b>Unlimited boards</b></li>
              <li><b>Unlimited guests</b> — the free plan allows one at a time</li>
              <li><b>Version history &amp; backups</b> — restore any board</li>
              <li><b>Full-quality media</b> — plus video &amp; PDF embeds</li>
              <li><b>Private, passcode-locked boards</b></li>
            </ul>
            <div className="upgrade-price"><b>$3/mo</b> &nbsp;or&nbsp; <b>$24/yr</b> <span>(≈$2/mo)</span></div>
            <div className="plan-actions">
              {billing ? (
                <>
                  <button disabled={busy} onClick={() => onBuy('year')}>Annual · $24/yr</button>
                  <button className="primary" disabled={busy} onClick={() => onBuy('month')}>Monthly · $3/mo</button>
                </>
              ) : (
                <button className="primary" disabled title="Billing isn’t set up yet">Upgrade — coming soon</button>
              )}
            </div>
          </>
        )}

        <div className="modal-btns">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function ShareDialog({ board, plan, onUpgrade, onClose }) {
  const [token, setToken] = useState(board.shareToken || null)
  const [mode, setMode] = useState(board.shareMode || 'view')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const isPro = plan === 'pro'
  const link = token ? `${window.location.origin}/s/${token}` : ''

  const applyShare = async (nextMode) => {
    setBusy(true)
    const res = await apiSetShare(board.id, nextMode)
    setBusy(false)
    if (res && res.error) {
      if (res.error.code === 'pro_required') onUpgrade()
      return
    }
    if (res && res.shareToken) {
      setToken(res.shareToken)
      setMode(res.shareMode)
      store.setBoardShare(board.id, res.shareToken, res.shareMode)
    }
  }

  const revoke = async () => {
    setBusy(true)
    const res = await apiRevokeShare(board.id)
    setBusy(false)
    if (res && !res.error) {
      setToken(null)
      store.setBoardShare(board.id, null, mode)
    }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(link) } catch (e) {}
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  const guestHint = !isPro ? (
    <p className="share-hint">
      Free plan: <b>one guest at a time</b>.{' '}
      <button type="button" className="share-hint-link" onClick={onUpgrade}>Upgrade</button> for unlimited guests.
    </p>
  ) : null

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal share-modal">
        <h2>Share “{board.name}”</h2>
        {!token ? (
          <>
            <p className="share-sub">Create a link anyone can open — no account needed.</p>
            {guestHint}
            <div className="modal-btns">
              <button onClick={onClose}>Cancel</button>
              <button className="primary" disabled={busy} onClick={() => applyShare('view')}>Create link</button>
            </div>
          </>
        ) : (
          <>
            <label className="share-label">Anyone with the link</label>
            <div className="share-linkrow">
              <input className="share-link" readOnly value={link} onFocus={(e) => e.target.select()} />
              <button className="primary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            </div>

            <div className="share-modes">
              <button className={`share-mode-opt ${mode === 'view' ? 'on' : ''}`} disabled={busy} onClick={() => applyShare('view')}>
                <b>View only</b><span>Can look, can’t change anything</span>
              </button>
              <button className={`share-mode-opt ${mode === 'edit' ? 'on' : ''}`} disabled={busy} onClick={() => applyShare('edit')}>
                <b>Can edit</b><span>Anyone with the link can change the board</span>
              </button>
            </div>

            {guestHint}

            <div className="modal-btns">
              <button className="danger" disabled={busy} onClick={revoke}>Stop sharing</button>
              <button className="primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ShareErrorView({ message }) {
  return (
    <div className="share-error">
      <div className="share-error-card">
        <span className="share-logo" />
        <h2>Board not available</h2>
        <p>{message}</p>
        <a className="primary-link" href="/">Go to SimpleBoard</a>
      </div>
    </div>
  )
}