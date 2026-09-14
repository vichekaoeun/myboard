import React, { memo, useEffect, useRef } from 'react'
import { EnvelopeClosed, EnvelopeFlapOpen } from './art.jsx'

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
  env, selected, dropActive, getZoom,
  onSelect, onChange, onMoveEnd, onToggle, onContextMenu,
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
    e.preventDefault()
    e.stopPropagation()
    onSelect(env.id)
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
      else onSelect(env.id)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
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
        zIndex: selected ? 30 : 12,
      }}
      onPointerDown={startDrag}
      onDoubleClick={(e) => { e.stopPropagation(); onToggle(env.id) }}
      onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); e.stopPropagation(); onContextMenu(e, env, 'env') } }}
    >
      <div className="env-art">{env.expanded ? <EnvelopeFlapOpen /> : <EnvelopeClosed />}</div>
      <div className="env-texture" />

      <div className="env-note-stack">
        {!env.expanded &&
          count > 0 &&
          Array.from({ length: Math.min(3, count) }).map((_, i) => (
            <div key={i} className="env-stack-paper" style={{ transform: `rotate(${9 - i * 10}deg)`, zIndex: 12 - i }}>
              <div className="env-stack-lines"><span /><span /><span /></div>
            </div>
          ))}
      </div>

      <div className="env-count">{count}</div>

      <button
        className={`env-toggle ${env.expanded ? 'open' : ''}`}
        title={env.expanded ? 'Tuck letters back in' : 'Open the envelope'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onToggle(env.id) }}
      >
        {env.expanded ? '▾' : `${count > 0 ? count + ' ' : ''}open`}
      </button>

      {!env.expanded && (
        <div
          className="env-title"
          contentEditable
          suppressContentEditableWarning
          ref={titleRef}
          onBlur={commitTitle}
          onPointerDown={(e) => { e.stopPropagation(); onSelect(env.id) }}
          onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation() }}
        />
      )}
    </div>
  )
})