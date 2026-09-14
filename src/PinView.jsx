import React, { memo, useRef } from 'react'
import { PushPin } from './art.jsx'

export default memo(function PinView({ item, selected, getZoom, onSelect, onMoveEnd, onContextMenu }) {
  const wrapRef = useRef(null)
  const drag = useRef(null)

  function startDrag(e) {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    onSelect(item.id)
    const start = { sx: e.clientX, sy: e.clientY, x: item.x, y: item.y }
    const d = { moved: false, x: item.x, y: item.y }
    drag.current = d
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)

    const onMove = (ev) => {
      const dd = drag.current
      if (!dd) return
      const s = getZoom()
      const dx = (ev.clientX - start.sx) / s
      const dy = (ev.clientY - start.sy) / s
      if (!dd.moved && Math.hypot(dx, dy) > 3 / s) dd.moved = true
      dd.x = start.x + dx
      dd.y = start.y + dy
      if (wrapRef.current) {
        wrapRef.current.style.left = dd.x - 23 + 'px'
        wrapRef.current.style.top = dd.y - 88 + 'px'
      }
    }
    const onUp = (ev) => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      try { el.releasePointerCapture(ev.pointerId) } catch (_) {}
      const dd = drag.current
      drag.current = null
      if (!dd) return
      if (dd.moved) onMoveEnd(item.id, dd.x, dd.y)
      else onSelect(item.id)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  return (
    <div
      ref={wrapRef}
      data-id={item.id}
      className={`pin-item ${selected ? 'pin-selected' : ''}`}
      style={{
        left: item.x - 23, top: item.y - 88, width: 46, height: 92, zIndex: selected ? 35 : 8,
      }}
      onPointerDown={startDrag}
      onClick={(e) => { e.stopPropagation(); onSelect(item.id) }}
      onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); e.stopPropagation(); onContextMenu(e, item, 'pin') } }}
    >
      <div className="pin-body" onClick={(e) => e.stopPropagation()}>
        <PushPin color={item.color} size={44} />
      </div>
      {selected && <div className="pin-selection" />}
      <div className="pin-hole" />
    </div>
  )
})