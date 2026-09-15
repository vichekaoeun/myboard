import React, { memo, useRef } from 'react'
import { PushPin } from './art.jsx'

export default memo(function PinView({ item, selected, getZoom, onSelect, onMoveEnd, onContextMenu, onEditLocation, onResizeLocation }) {
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

  function startResize(e) {
    e.preventDefault()
    e.stopPropagation()
    const start = { sx: e.clientX, sy: e.clientY, w: item.location?.w || 300, h: item.location?.h || 330 }
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const onMove = (ev) => {
      const scale = getZoom()
      const width = Math.max(220, start.w + (ev.clientX - start.sx) / scale)
      const height = Math.max(220, start.h + (ev.clientY - start.sy) / scale)
      const card = wrapRef.current?.querySelector('.pin-map-card')
      if (card) { card.style.width = width + 'px'; card.style.height = height + 'px' }
    }
    const onUp = (ev) => {
      const scale = getZoom()
      const width = Math.max(220, start.w + (ev.clientX - start.sx) / scale)
      const height = Math.max(220, start.h + (ev.clientY - start.sy) / scale)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      try { el.releasePointerCapture(ev.pointerId) } catch (_) {}
      onResizeLocation(item.id, width, height)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <div
      ref={wrapRef}
      data-id={item.id}
      className={`pin-item ${item.location ? 'pin-location-item' : ''} ${selected ? 'pin-selected' : ''}`}
      style={{
        left: item.x - 23, top: item.y - 88, width: 46, height: 92, zIndex: selected ? 35 : 8,
      }}
      onPointerDown={startDrag}
      onClick={(e) => { e.stopPropagation(); onSelect(item.id) }}
      onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); e.stopPropagation(); onContextMenu(e, item, 'pin') } }}
    >
      {!item.location && (
        <>
          <div className="pin-body" onClick={(e) => e.stopPropagation()}>
            <PushPin color={item.color} size={44} />
          </div>
          {selected && <div className="pin-selection" />}
          <div className="pin-hole" />
        </>
      )}
      {item.location && (item.location.query || item.location.photo) && (
        <div
          className="pin-map-card"
          style={{ width: item.location.w || 300, height: item.location.h || (item.location.photo ? 220 : 330) }}
          onPointerDown={(e) => {
            if (e.target.closest('button, iframe')) e.stopPropagation()
          }}
          onClick={(e) => {
            if (!item.location.query || e.target.closest('button, iframe, .pin-location-resize')) return
            window.location.assign(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.location.query)}`)
          }}
        >
          <span className="pin-card-tape pin-card-tape-tl" />
          <span className="pin-card-tape pin-card-tape-tr" />
          <span className="pin-card-tape pin-card-tape-bl" />
          <span className="pin-card-tape pin-card-tape-br" />
          <div className="pin-map-title">{item.location.query}</div>
          {item.location.photo && <img className="pin-location-photo" src={item.location.photo} alt={item.location.query || 'Location'} />}
          {!item.location.photo && item.location.query && <iframe
              title={`Map for ${item.location.query}`}
              src={`https://www.google.com/maps?q=${encodeURIComponent(item.location.query)}&output=embed`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />}
          <div className="pin-map-actions">
            {item.location.query && <button type="button" className="pin-map-open" onClick={() => window.location.assign(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.location.query)}`)}>Open in Google Maps</button>}
            <button type="button" onClick={() => onEditLocation(item)}>Edit location</button>
          </div>
          <div className="pin-location-resize" onPointerDown={startResize} />
        </div>
      )}
    </div>
  )
})