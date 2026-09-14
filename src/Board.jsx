import React, { useEffect, useRef } from 'react'
import NoteView from './Note.jsx'
import PinView from './PinView.jsx'
import EnvelopeView, { fanPoses } from './Envelope.jsx'

const WORLD_SIZE = 240000

export default function Board({
  containerRef, cameraRef, notes, pins, envelopes, selected, mode, getZoom, tick,
  onSelect, onChange, onEnvChange, onMoveEnd, onEnvMoveEnd, onPinMoveEnd, onFanDrop, onDragMove,
  onAddNote, onAddPin, onAddEnvelope, onToggleEnvelope,
  onCtxBackground, onCtxItem, hoverEnvId,
}) {
  const pan = useRef(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function worldAt(e) {
    return cameraRef.current.worldPoint(e.clientX, e.clientY)
  }

  function startPan(e) {
    const start = { sx: e.clientX, sy: e.clientY }
    pan.current = { ...start }
    const el = containerRef.current
    el.setPointerCapture(e.pointerId)
    const onMove = (ev) => {
      const pp = pan.current
      if (!pp) return
      const ddx = ev.clientX - pp.sx
      const ddy = ev.clientY - pp.sy
      pp.sx = ev.clientX
      pp.sy = ev.clientY
      cameraRef.current.panBy(ddx, ddy)
    }
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      try { el.releasePointerCapture(e.pointerId) } catch (_) {}
      pan.current = null
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  function handleBgPointerDown(e) {
    if (e.button !== 0) return
    const w = worldAt(e)
    if (mode === 'note' || mode === 'pin' || mode === 'envelope') {
      e.stopPropagation()
      if (mode === 'note') onAddNote(w.x, w.y)
      else if (mode === 'pin') onAddPin(w.x, w.y)
      else onAddEnvelope(w.x, w.y)
      return
    }
    onSelect(null)
    startPan(e)
  }

  const handleWheel = (e) => {
    e.preventDefault()
    const c = cameraRef.current
    if (e.ctrlKey || e.metaKey) {
      const dz = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
      const factor = Math.exp(-dz * 0.0021)
      c.zoomAt(e.clientX, e.clientY, factor)
    } else {
      const k = e.deltaMode === 1 ? 24 : e.deltaMode === 2 ? window.innerHeight : 1
      c.panBy(e.deltaX * k, e.deltaY * k)
    }
  }

  return (
    <div
      ref={containerRef}
      className="board"
      onPointerDown={handleBgPointerDown}
      onDoubleClick={(e) => {
        if (!e.target.closest('.note,.envelope,.pin-item')) {
          const w = worldAt(e)
          onAddNote(w.x, w.y)
        }
      }}
      onContextMenu={(e) => {
        if (e.target.closest('.note,.envelope,.pin-item')) return
        e.preventDefault()
        const w = worldAt(e)
        onCtxBackground({ x: e.clientX, y: e.clientY, wx: w.x, wy: w.y })
      }}
    >
      <div className="cork-plane" style={{ left: -WORLD_SIZE / 2, top: -WORLD_SIZE / 2, width: WORLD_SIZE, height: WORLD_SIZE }} />

      <div className="world">
        {envelopes.map((env) => (
          <EnvelopeView
            key={env.id}
            env={env}
            selected={selected === env.id}
            dropActive={hoverEnvId === env.id}
            getZoom={getZoom}
            onSelect={onSelect}
            onChange={onEnvChange}
            onMoveEnd={onEnvMoveEnd}
            onToggle={onToggleEnvelope}
            onContextMenu={onCtxItem}
          />
        ))}

        {envelopes.map((env) => {
          if (!env.expanded) return null
          const poses = fanPoses(env, env.noteIds, notes)
          return env.noteIds.map((id) => {
            const note = notes.find((x) => x.id === id)
            const p = poses[id]
            if (!note || !p) return null

            return (
              <NoteView
                key={`fan-${id}`}
                item={note}
                x={p.x}
                y={p.y}
                scale={p.scale}
                rotation={p.rotation}
                mode="fan"
                z={44}
                tick={tick}
                getZoom={getZoom}
                onSelect={onSelect}
                onChange={onChange}
                onMoveEnd={() => {}}
                onDrop={onFanDrop}
                onDragMove={onDragMove}
                onContextMenu={onCtxItem}
              />
            )
          })
        })}

        {notes.filter((n) => !n.groupId).map((note) => (
          <NoteView
            key={note.id}
            item={note}
            x={note.x}
            y={note.y}
            scale={1}
            rotation={note.rotation}
            selected={selected === note.id}
            tick={tick}
            getZoom={getZoom}
            onSelect={onSelect}
            onChange={onChange}
            onMoveEnd={onMoveEnd}
            onDragMove={onDragMove}
            onContextMenu={onCtxItem}
          />
        ))}

        {pins.map((pin) => (
          <PinView
            key={pin.id}
            item={pin}
            selected={selected === pin.id}
            getZoom={getZoom}
            onSelect={onSelect}
            onMoveEnd={onPinMoveEnd}
            onContextMenu={onCtxItem}
          />
        ))}
      </div>
    </div>
  )
}