// Selection + group-drag helpers shared by every item view.

import { getState, moveItems, select, toggleSelect } from './store.js'
import { updateRopesForNote } from './ropes.js'

// Decide what a pointerdown means for selection. With a modifier we toggle the
// item in/out of the selection and don't start a drag; otherwise we make sure
// the item is selected and report whether to drag it alone or with the group.
export function pointerSelect(id, e) {
  if (e.ctrlKey || e.metaKey || e.shiftKey) {
    toggleSelect(id)
    return { drag: false, group: false }
  }
  const ids = getState().selectedIds || []
  if (ids.includes(id)) return { drag: true, group: ids.length > 1 }
  select(id)
  return { drag: true, group: false }
}

// Drag every selected item together, reading each node's current position from
// the DOM so it works for any item type. Falls back to selecting just the
// clicked item when the pointer didn't actually move.
export function startGroupDrag(e, getZoom, clickedId) {
  const st = getState()
  const ids = st.selectedIds || []
  const noteW = new Map(st.notes.map((n) => [n.id, n.w]))
  const nodes = ids.map((id) => {
    const el = document.querySelector(`[data-id="${id}"]`)
    if (!el) return null
    return { id, el, x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0 }
  }).filter(Boolean)
  if (!nodes.length) return

  const start = { sx: e.clientX, sy: e.clientY }
  const el = e.currentTarget
  let moved = false
  try { el.setPointerCapture(e.pointerId) } catch (_) {}

  const onMove = (ev) => {
    const s = getZoom()
    const dx = (ev.clientX - start.sx) / s
    const dy = (ev.clientY - start.sy) / s
    if (!moved && Math.hypot(dx, dy) > 3 / s) moved = true
    nodes.forEach((n) => {
      n.el.style.left = (n.x + dx) + 'px'
      n.el.style.top = (n.y + dy) + 'px'
      if (noteW.has(n.id)) updateRopesForNote(n.id, n.x + dx, n.y + dy, noteW.get(n.id))
    })
  }
  const onUp = (ev) => {
    const s = getZoom()
    const dx = (ev.clientX - start.sx) / s
    const dy = (ev.clientY - start.sy) / s
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onUp)
    try { el.releasePointerCapture(ev.pointerId) } catch (_) {}
    if (!moved) {
      if (clickedId) select(clickedId)
      return
    }
    moveItems(Math.round(dx), Math.round(dy))
  }
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onUp)
}
