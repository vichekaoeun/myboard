import React, { memo, useRef } from 'react'
import { pointerSelect, startGroupDrag } from './drag.js'

// A saved link rendered as a newspaper clipping pinned to the cork.
export default memo(function CardView({
  item, selected, primary, getZoom, onPointerSelect, onMoveEnd, onResizeEnd, onOpen, onContextMenu,
}) {
  const wrapRef = useRef(null)
  const drag = useRef(null)

  function startDrag(e) {
    if (e.button !== undefined && e.button !== 0) return
    const res = onPointerSelect(item.id, e)
    e.preventDefault()
    e.stopPropagation()
    if (!res.drag) return
    if (res.group) { startGroupDrag(e, getZoom, item.id); return }
    const start = { sx: e.clientX, sy: e.clientY, x: item.x, y: item.y }
    const state = { moved: false, x: item.x, y: item.y }
    drag.current = state
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)

    const onMove = (ev) => {
      const cur = drag.current
      if (!cur) return
      const scale = getZoom()
      const dx = (ev.clientX - start.sx) / scale
      const dy = (ev.clientY - start.sy) / scale
      if (!cur.moved && Math.hypot(dx, dy) > 3 / scale) cur.moved = true
      cur.x = start.x + dx
      cur.y = start.y + dy
      if (wrapRef.current) {
        wrapRef.current.style.left = cur.x + 'px'
        wrapRef.current.style.top = cur.y + 'px'
      }
    }

    const onUp = (ev) => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      try { el.releasePointerCapture(ev.pointerId) } catch (_) {}
      const cur = drag.current
      drag.current = null
      if (cur && cur.moved) onMoveEnd(item.id, cur.x, cur.y)
      else if (onOpen) onOpen(item)
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
      if (edge.includes('e')) nw = Math.max(200, startW + dx)
      if (edge.includes('w')) { nw = Math.max(200, startW - dx); nx = startX + (startW - nw) }
      if (edge.includes('s')) nh = Math.max(150, startH + dy)
      if (edge.includes('n')) { nh = Math.max(150, startH - dy); ny = startY + (startH - nh) }
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
      if (edge.includes('e')) nw = Math.max(200, startW + dx)
      if (edge.includes('w')) { nw = Math.max(200, startW - dx); nx = startX + (startW - nw) }
      if (edge.includes('s')) nh = Math.max(150, startH + dy)
      if (edge.includes('n')) { nh = Math.max(150, startH - dy); ny = startY + (startH - nh) }
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

  let host = ''
  try { host = new URL(item.url).hostname.replace(/^www\./, '') } catch (e) { host = '' }

  return (
    <div
      ref={wrapRef}
      data-id={item.id}
      className={`link-card ${selected ? 'link-card-selected' : ''}`}
      style={{
        left: item.x, top: item.y, width: item.w, height: item.h,
        transform: `rotate(${item.rotation || 0}deg)`,
        zIndex: selected ? 41 : 11,
      }}
      onPointerDown={startDrag}
      onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); e.stopPropagation(); onContextMenu(e, item, 'card') } }}
    >
      <span className="link-card-tape" aria-hidden="true" />
      <div className="link-card-body">
        <div className="link-card-masthead">
          {item.favicon ? (
            <img
              className="link-card-favicon"
              src={item.favicon}
              alt=""
              draggable={false}
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          ) : null}
          <span className="link-card-site">{item.siteName || host || 'link'}</span>
        </div>
        <div className="link-card-rule" />
        <div className="link-card-headline">{item.title || host || item.url}</div>
        {item.image ? (
          <div className="link-card-photo">
            <img
              src={item.image}
              alt=""
              draggable={false}
              onError={(e) => { const p = e.currentTarget.closest('.link-card-photo'); if (p) p.style.display = 'none' }}
            />
          </div>
        ) : null}
        {item.description ? <div className="link-card-desc">{item.description}</div> : null}
        <div className="link-card-foot"><span className="link-card-read">Read article ↗</span></div>
      </div>

      {primary && (
        <div className="link-card-resize">
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
