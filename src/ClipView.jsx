import React, { memo, useRef } from 'react'
import { PaperClip } from './art.jsx'

export default memo(function ClipView({ item, selected, getZoom, onSelect, onMoveEnd, onResizeEnd, onContextMenu }) {
  const wrapRef = useRef(null)
  const drag = useRef(null)

  function startDrag(e) {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    onSelect(item.id)
    const start = { sx: e.clientX, sy: e.clientY, x: item.x, y: item.y }
    const state = { moved: false, x: item.x, y: item.y }
    drag.current = state
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)

    const onMove = (ev) => {
      const current = drag.current
      if (!current) return
      const scale = getZoom()
      const dx = (ev.clientX - start.sx) / scale
      const dy = (ev.clientY - start.sy) / scale
      if (!current.moved && Math.hypot(dx, dy) > 3 / scale) current.moved = true
      current.x = start.x + dx
      current.y = start.y + dy
      if (wrapRef.current) {
        wrapRef.current.style.left = current.x + 'px'
        wrapRef.current.style.top = current.y + 'px'
      }
    }

    const onUp = (ev) => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      try { el.releasePointerCapture(ev.pointerId) } catch (_) {}
      const current = drag.current
      drag.current = null
      if (current && current.moved) onMoveEnd(item.id, current.x, current.y)
      else onSelect(item.id)
    }

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  function startResize(e, edge) {
    e.preventDefault()
    e.stopPropagation()
    const startW = item.w
    const startH = item.h
    const startX = item.x
    const startY = item.y
    const start = { sx: e.clientX, sy: e.clientY }
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)

    const onMove = (ev) => {
      const scale = getZoom()
      const dx = (ev.clientX - start.sx) / scale
      const dy = (ev.clientY - start.sy) / scale

      let nw = startW, nh = startH, nx = startX, ny = startY
      if (edge.includes('e')) nw = Math.max(120, startW + dx)
      if (edge.includes('w')) { nw = Math.max(120, startW - dx); nx = startX + (startW - nw) }
      if (edge.includes('s')) nh = Math.max(100, startH + dy)
      if (edge.includes('n')) { nh = Math.max(100, startH - dy); ny = startY + (startH - nh) }

      if (wrapRef.current) {
        wrapRef.current.style.width = nw + 'px'
        wrapRef.current.style.height = nh + 'px'
        wrapRef.current.style.left = nx + 'px'
        wrapRef.current.style.top = ny + 'px'
      }
    }
    const onUp = (ev) => {
      const scale = getZoom()
      const dx = (ev.clientX - start.sx) / scale
      const dy = (ev.clientY - start.sy) / scale

      let nw = startW, nh = startH, nx = startX, ny = startY
      if (edge.includes('e')) nw = Math.max(120, startW + dx)
      if (edge.includes('w')) { nw = Math.max(120, startW - dx); nx = startX + (startW - nw) }
      if (edge.includes('s')) nh = Math.max(100, startH + dy)
      if (edge.includes('n')) { nh = Math.max(100, startH - dy); ny = startY + (startH - nh) }

      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      try { el.releasePointerCapture(ev.pointerId) } catch (_) {}
      onResizeEnd(item.id, Math.round(nw), Math.round(nh))
      if (nx !== startX || ny !== startY) onMoveEnd(item.id, Math.round(nx), Math.round(ny))
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  return (
    <div
      ref={wrapRef}
      data-id={item.id}
      className={`clip-item ${selected ? 'clip-selected' : ''}`}
      style={{ left: item.x, top: item.y, width: item.w, height: item.h, transform: `rotate(${item.rotation || 0}deg)`, zIndex: selected ? 42 : 12 }}
      onPointerDown={startDrag}
      onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); e.stopPropagation(); onContextMenu(e, item, 'clip') } }}
    >
      <div className="clip-icon"><PaperClip /></div>
      <img src={item.url} alt="Attached image" draggable={false} />
      {selected && <div className="clip-selection" />}
      {selected && (
        <div className="clip-resize">
          <div className="resize-nw" onPointerDown={(e) => startResize(e, 'nw')} />
          <div className="resize-ne" onPointerDown={(e) => startResize(e, 'ne')} />
          <div className="resize-sw" onPointerDown={(e) => startResize(e, 'sw')} />
          <div className="resize-se" onPointerDown={(e) => startResize(e, 'se')} />
          <div className="resize-n" onPointerDown={(e) => startResize(e, 'n')} />
          <div className="resize-s" onPointerDown={(e) => startResize(e, 's')} />
          <div className="resize-e" onPointerDown={(e) => startResize(e, 'e')} />
          <div className="resize-w" onPointerDown={(e) => startResize(e, 'w')} />
        </div>
      )}
    </div>
  )
})
