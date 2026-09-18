// Red-string geometry, shared by the React render (Board) and the imperative
// live updater used while a note is being dragged or resized.

import { getState } from './store.js'

// A rope hangs from just below each note's pin (top-centre) with a little sag.
// Also returns an arrowhead path (for directed types) and the curve midpoint
// (for a label tag).
export function ropeGeometry(a, b) {
  // Anchor just above the paper's top edge (where the pin is) so the string,
  // its arrowhead, and its label all sit in front of the cork and stay visible.
  const ax = a.x + (a.w || 250) / 2
  const ay = a.y - 1
  const bx = b.x + (b.w || 250) / 2
  const by = b.y - 1
  const dist = Math.hypot(bx - ax, by - ay)
  const sag = Math.min(140, 26 + dist * 0.16)
  const cx = (ax + bx) / 2
  const cy = (ay + by) / 2 + sag
  const d = `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`

  // Quadratic midpoint (t = 0.5).
  const mx = (ax + 2 * cx + bx) / 4
  const my = (ay + 2 * cy + by) / 4

  // Arrowhead at the target end; tangent at t=1 is P2 - C.
  const dx = bx - cx
  const dy = by - cy
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const px = -uy
  const py = ux
  const size = 12
  const wing = 6
  const tipX = bx - ux * 9
  const tipY = by - uy * 9
  const b1x = tipX - ux * size + px * wing
  const b1y = tipY - uy * size + py * wing
  const b2x = tipX - ux * size - px * wing
  const b2y = tipY - uy * size - py * wing
  const arrow = `M ${tipX} ${tipY} L ${b1x} ${b1y} L ${b2x} ${b2y} Z`

  return { d, arrow, mid: { x: mx, y: my } }
}

export function ropePath(a, b) {
  return ropeGeometry(a, b).d
}

// Recompute the ropes attached to a note that is mid-drag/-resize, using the
// live position for that note and the store position for the other endpoint.
// Called directly from the drag handlers so strings follow in real time instead
// of snapping on drop. React leaves these attributes alone because the store
// (and therefore its geometry) hasn't changed yet.
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
    const geo = ropeGeometry(a, b)
    g.querySelectorAll('path.rope-line, path.rope-shadow, path.rope-hit')
      .forEach((p) => p.setAttribute('d', geo.d))
    const arrow = g.querySelector('path.rope-arrow')
    if (arrow) arrow.setAttribute('d', geo.arrow)
    const label = g.querySelector('.rope-labelwrap')
    if (label) label.setAttribute('transform', `translate(${geo.mid.x} ${geo.mid.y})`)
  })
}
