// Infinite pan/zoom camera. The view is mutated directly on the DOM for
// smoothness; the store's view is used only for persistence.

import { getState, setView } from './store.js'
import { WORLD_SIZE, CORK_MIN, CORK_MAX } from './store.js'

const MIN_S = 0.06
const MAX_S = 7

export class Camera {
  constructor(el) {
    this.el = el
    this.v = { ...getState().view }
    this.tween = null
    this.flushTimers = new Set()
    // Keeping history here is purely for reference noise; the real clamping
    // happens in clampView() below which bounds the camera so the cork can
    // never be panned completely off-screen.
  }

  flush() {
    const s = this.v.s
    this.el.style.transform = `translate3d(${this.v.x}px, ${this.v.y}px, 0) scale(${s})`
  }

  scheduleFlush() {
    if (this.flushTimers.size) return
    const id = requestAnimationFrame(() => {
      this.flushTimers.delete(id)
      this.flush()
    })
    this.flushTimers.add(id)
  }

  worldPoint(sx, sy) {
    return { x: (sx - this.v.x) / this.v.s, y: (sy - this.v.y) / this.v.s }
  }

  panBy(dx, dy) {
    this.v.x += dx
    this.v.y += dy
    this.clampView()
    this.persist()
    this.scheduleFlush()
  }

  zoomAt(sx, sy, factor) {
    const ns = Math.min(MAX_S, Math.max(MIN_S, this.v.s * factor))
    const k = ns / this.v.s
    if (k === 1) return
    this.v.x = sx - (sx - this.v.x) * k
    this.v.y = sy - (sy - this.v.y) * k
    this.v.s = ns
    this.clampView()
    this.persist()
    this.scheduleFlush()
  }

  // Bounds the camera so the cork behaves like the entire background: while
  // the cork is taller/wider than the viewport we can never pan far enough to
  // reveal the brown void around it; once zoomed out beyond that we simply
  // centre the cork so nothing can be panned completely off-screen.
  clampView() {
    const vw = window.innerWidth, vh = window.innerHeight
    const s = this.v.s
    const corkW = CORK_MAX - CORK_MIN, corkH = corkW
    const vwW = vw / s, vhH = vh / s
    if (vwW <= corkW) {
      const wx0 = -this.v.x / s
      this.v.x = -Math.max(CORK_MIN, Math.min(CORK_MAX - vwW, wx0)) * s
    } else {
      this.v.x = (vw - corkW * s) / 2
    }
    if (vhH <= corkH) {
      const wy0 = -this.v.y / s
      this.v.y = -Math.max(CORK_MIN, Math.min(CORK_MAX - vhH, wy0)) * s
    } else {
      this.v.y = (vh - corkH * s) / 2
    }
  }

  persist() {
    setView({ ...this.v })
  }

  stopTween() {
    if (this.tween) {
      cancelAnimationFrame(this.tween)
      this.tween = null
    }
  }

  animateTo(tx, ty, ts, opts = {}) {
    this.stopTween()
    const from = { x: this.v.x, y: this.v.y, s: this.v.s }
    const target = {
      x: tx, y: ty,
      s: Math.min(MAX_S, Math.max(MIN_S, ts)),
    }
    const dur = opts.duration ?? 540
    const ease = opts.background
      ? (t) => 1 - Math.pow(1 - t, 4)
      : (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
    const start = performance.now()
    const done = opts.onDone || (() => {})
    const tick = (now) => {
      let t = Math.min(1, (now - start) / dur)
      t = ease(t)
      this.v.x = from.x + (target.x - from.x) * t
      this.v.y = from.y + (target.y - from.y) * t
      this.v.s = from.s + (target.s - from.s) * t
      this.persist()
      this.flush()
      if (t >= 1) {
        this.tween = null
        done()
      } else {
        this.tween = requestAnimationFrame(tick)
      }
    }
    this.tween = requestAnimationFrame(tick)
  }

  focusOn(worldX, worldY, size, opts = {}) {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const s = Math.min(MAX_S, Math.max(MIN_S, Math.min(vw / (size + 80), vh / (size + 80))))
    this.animateTo(vw / 2 - worldX * s, vh / 2 - worldY * s, s, opts)
  }

  fit(items) {
    const boxes = []
    const add = (x, y, w, h) => { boxes.push([x, y, w, h]) }
    items.notes.forEach((n) => add(n.x, n.y, n.w, n.h))
    items.pins.forEach((p) => add(p.x - 20, p.y - 60, 40, 60))
    items.envelopes.forEach((e) => add(e.x, e.y, e.w, e.h))
    ;(items.clips || []).forEach((c) => add(c.x, c.y, c.w || 220, c.h || 180))
    ;(items.music || []).forEach((m) => add(m.x, m.y, m.w || 320, m.h || 180))
    if (!boxes.length) {
      this.animateTo(window.innerWidth / 2, window.innerHeight / 2, 1)
      return
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    boxes.forEach(([x, y, w, h]) => {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x + w)
      maxY = Math.max(maxY, y + h)
    })
    const bw = maxX - minX, bh = maxY - minY
    const pad = 140
    const s = Math.min(MAX_S, Math.max(MIN_S, Math.min(window.innerWidth / (bw + pad * 2), window.innerHeight / (bh + pad * 2))))
    const cx = minX + bw / 2, cy = minY + bh / 2
    this.animateTo(window.innerWidth / 2 - cx * s, window.innerHeight / 2 - cy * s, s)
  }
}