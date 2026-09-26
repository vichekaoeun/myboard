import React, { memo, useEffect, useRef } from 'react'
import { EnvelopeClosed, EnvelopeFlapOpen } from './art.jsx'
import { LinkIcon } from './icons.jsx'
import { pointerSelect, startGroupDrag } from './drag.js'
import { stackZ } from './stack.js'

export function fanPoses(env, noteIds, notes) {
  const n = noteIds.length
  const poses = {}
  if (!n) return poses
  const cx = env.x + env.w / 2
  const anchor = env.y + env.h / 2
  const R = Math.min(120 + n * 16, 330)
  noteIds.forEach((id, i) => {
    const note = notes.find((x) => x.id === id)
    if (!note) return
    const t = n === 1 ? 0 : (i - (n - 1) / 2) / (n - 1)
    const ang = (t * 56 * Math.PI) / 180
    const px = cx + Math.sin(ang) * R
    const py = anchor - Math.cos(ang) * R * 0.78
    const scale = Math.max(0.42, Math.min(0.8, 0.6 + (n - i) * 0.012))
    poses[id] = {
      x: px - (note.w * scale) / 2,
      y: py - ((note.h || 280) * scale) / 2,
      scale,
      rotation: t * 30 + (note.rotation || 0) * 0.4 + 4,
    }
  })
  return poses
}

export default memo(function EnvelopeView({
  env, selected, primary, dropActive, getZoom, linkCount = 0,
  onPointerSelect, onChange, onMoveEnd, onToggle, onContextMenu, readonly = false,
}) {
  const wrapRef = useRef(null)
  const drag = useRef(null)
  const titleRef = useRef(null)
  const lastTitle = useRef(null)
  const count = env.noteIds.length

  useEffect(() => {
    const el = titleRef.current
    if (el && lastTitle.current !== env.title) {
      el.textContent = env.title
      lastTitle.current = env.title
    }
  }, [env.title])

  function startDrag(e) {
    if (e.button !== undefined && e.button !== 0) return
    const res = onPointerSelect(env.id, e)
    e.preventDefault()
    e.stopPropagation()
    if (!res.drag) return
    if (res.group) { startGroupDrag(e, getZoom, env.id); return }
    const start = { sx: e.clientX, sy: e.clientY, x: env.x, y: env.y }
    const d = { moved: false, x: env.x, y: env.y }
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
      const w = wrapRef.current
      if (w) { w.style.left = dd.x + 'px'; w.style.top = dd.y + 'px' }
    }
    const onUp = (ev) => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      try { el.releasePointerCapture(ev.pointerId) } catch (_) {}
      const dd = drag.current
      drag.current = null
      if (!dd) return
      if (dd.moved) onMoveEnd(env.id, dd.x, dd.y)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  function startResize(e, edge) {
    e.preventDefault()
    e.stopPropagation()
    const sc = getZoom()
    const startW = env.w
    const startH = env.h
    const startX = env.x
    const startY = env.y
    const start = { sx: e.clientX, sy: e.clientY }

    const onMove = (ev) => {
      const ns = getZoom()
      const dx = (ev.clientX - start.sx) / ns
      const dy = (ev.clientY - start.sy) / ns

      let nw = startW, nh = startH, nx = startX, ny = startY
      if (edge.includes('e')) nw = Math.max(200, startW + dx)
      if (edge.includes('w')) { nw = Math.max(200, startW - dx); nx = startX + (startW - nw) }
      if (edge.includes('s')) nh = Math.max(140, startH + dy)
      if (edge.includes('n')) { nh = Math.max(140, startH - dy); ny = startY + (startH - nh) }

      const w = wrapRef.current
      if (w) {
        w.style.width = nw + 'px'
        w.style.height = nh + 'px'
        w.style.left = nx + 'px'
        w.style.top = ny + 'px'
      }
    }
    const onUp = (ev) => {
      const ns = getZoom()
      const dx = (ev.clientX - start.sx) / ns
      const dy = (ev.clientY - start.sy) / ns

      let nw = startW, nh = startH, nx = startX, ny = startY
      if (edge.includes('e')) nw = Math.max(200, startW + dx)
      if (edge.includes('w')) { nw = Math.max(200, startW - dx); nx = startX + (startW - nw) }
      if (edge.includes('s')) nh = Math.max(140, startH + dy)
      if (edge.includes('n')) { nh = Math.max(140, startH - dy); ny = startY + (startH - nh) }

      ev.currentTarget.removeEventListener('pointermove', onMove)
      ev.currentTarget.removeEventListener('pointerup', onUp)
      ev.currentTarget.removeEventListener('pointercancel', onUp)
      try { ev.currentTarget.releasePointerCapture(ev.pointerId) } catch (_) {}
      onChange(env.id, { w: Math.round(nw), h: Math.round(nh), x: Math.round(nx), y: Math.round(ny) })
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.addEventListener('pointermove', onMove)
    e.currentTarget.addEventListener('pointerup', onUp)
    e.currentTarget.addEventListener('pointercancel', onUp)
  }

  function commitTitle() {
    const el = titleRef.current
    if (!el) return
    const t = (el.textContent || '').trim() || 'My letters'
    if (t !== lastTitle.current) {
      lastTitle.current = t
      onChange(env.id, { title: t })
    }
  }

return (
    <div
      ref={wrapRef}
      data-id={env.id}
      className={`envelope ${selected ? 'envelope-selected' : ''} ${dropActive ? 'envelope-drop' : ''}`}
      style={{
        left: env.x, top: env.y, width: env.w, height: env.h,
        zIndex: stackZ(env, 12, selected),
      }}
      onPointerDown={startDrag}
      onDoubleClick={(e) => { e.stopPropagation(); onToggle(env.id) }}
      onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); e.stopPropagation(); onContextMenu(e, env, 'env') } }}
    >
      <div className="env-art">{env.expanded ? <EnvelopeFlapOpen /> : <EnvelopeClosed />}</div>
      <div className="env-texture" />

      {!env.expanded && count > 0 && linkCount > 0 && (
        <span className="env-links" title={`${linkCount} linked note${linkCount === 1 ? '' : 's'} inside`}>
          <LinkIcon size={12} />
          <span>{linkCount}</span>
        </span>
      )}

      <button
        className={`env-toggle ${env.expanded ? 'open' : ''}`}
        title={env.expanded ? 'Tuck letters back in' : `Open the envelope (${count})`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onToggle(env.id) }}
      >
        {count > 0 && <span className="env-toggle-count">{count}</span>}
        <span className="env-toggle-chev" aria-hidden="true">{env.expanded ? '▴' : '▾'}</span>
      </button>

      {!env.expanded && (
        <div
          className="env-title"
          contentEditable={!readonly}
          suppressContentEditableWarning
          ref={titleRef}
          onBlur={commitTitle}
          onPointerDown={(e) => { e.stopPropagation(); onPointerSelect(env.id, e) }}
          onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation() }}
        />
      )}

      {primary && (
        <div className="envelope-resize">
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