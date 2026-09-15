// Red-string geometry, shared by the React render (Board) and the imperative
// live updater used while a note is being dragged or resized.

import { getState } from './store.js'

// A rope hangs from just below each note's pin (top-centre) with a little sag.
export function ropePath(a, b) {
  const ax = a.x + (a.w || 250) / 2
  const ay = a.y + 6
  const bx = b.x + (b.w || 250) / 2
  const by = b.y + 6
  const dist = Math.hypot(bx - ax, by - ay)
  const sag = Math.min(140, 26 + dist * 0.16)
  return `M ${ax} ${ay} Q ${(ax + bx) / 2} ${(ay + by) / 2 + sag} ${bx} ${by}`
}

// Recompute the ropes attached to a note that is mid-drag/-resize, using the
// live position for that note and the store position for the other endpoint.
// Called directly from the drag handlers so strings follow in real time instead
// of snapping on drop. React leaves these attributes alone because the store
// (and therefore its `d` prop) hasn't changed yet.
export function updateRopesForNote(id, x, y, w) {
  const notes = getState().notes
  const byId = new Map(notes.map((n) => [n.id, n]))
  const me = byId.get(id)
  const self = { x, y, w: w || (me && me.w) || 250 }
  const groups = document.querySelectorAll(
    `.rope[data-from="${id}"], .rope[data-to="${id}"]`
  )
  groups.forEach((g) => {
    const fromId = g.getAttribute('data-from')
    const toId = g.getAttribute('data-to')
    const a = fromId === id ? self : byId.get(fromId)
    const b = toId === id ? self : byId.get(toId)
    if (!a || !b) return
    const d = ropePath(a, b)
    g.querySelectorAll('path').forEach((p) => p.setAttribute('d', d))
  })
}
