import React, { useEffect, useMemo, useRef } from 'react'
import NoteView from './Note.jsx'
import PinView from './PinView.jsx'
import ClipView from './ClipView.jsx'
import MusicView from './MusicView.jsx'
import CardView from './CardView.jsx'
import EnvelopeView, { fanPoses } from './Envelope.jsx'
import { ropeGeometry } from './ropes.js'
import { connType } from './connections.js'

const WORLD_SIZE = 240000

export default function Board({
  containerRef, worldLayerRef, cameraRef, notes, pins, clips, music, cards = [], envelopes, links = [], connections = null, linkFrom = null, selected, mode, getZoom, tick,
  onSelect, onChange, onLiveHeight, onEnvChange, onMoveEnd, onEnvMoveEnd, onPinMoveEnd, onClipMoveEnd, onClipResizeEnd, onMusicMoveEnd, onMusicResizeEnd, onCardMoveEnd, onCardResizeEnd, onOpenCard, onFanDrop, onDragMove,
  onAddNote, onAddPin, onAddClip, onAddEnvelope, onToggleEnvelope,
  onCtxBackground, onCtxItem, onEditLocation, onResizeLocation, onLinkClick, onOpenLink, onCtxLink, hoverEnvId,
}) {
  const pan = useRef(null)
  const noteById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes])
  // Strings present when the board opened shouldn't "draw in"; only ones added
  // during this session animate. This ref is seeded once on first render.
  const initialLinksRef = useRef(null)
  if (initialLinksRef.current === null) initialLinksRef.current = new Set(links.map((l) => l.id))

  // Precompute rope geometry once per render for both layers (strings behind
  // notes; arrowheads + labels in front so they stay visible).
  const ropeItems = links.map((l) => {
    const a = noteById.get(l.from)
    const b = noteById.get(l.to)
    if (!a || !b || a.groupId || b.groupId) return null
    return { l, type: connType(l.type), geo: ropeGeometry(a, b), fresh: !initialLinksRef.current.has(l.id) }
  }).filter(Boolean)

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
      className={`board ${mode === 'link' ? 'linking' : ''}`}
      onPointerDown={handleBgPointerDown}
      onDoubleClick={(e) => {
        if (!e.target.closest('.note,.envelope,.pin-item,.music-item')) {
          const w = worldAt(e)
          onAddNote(w.x, w.y)
        }
      }}
      onContextMenu={(e) => {
        if (e.target.closest('.note,.envelope,.pin-item,.music-item')) return
        e.preventDefault()
        const w = worldAt(e)
        onCtxBackground({ x: e.clientX, y: e.clientY, wx: w.x, wy: w.y })
      }}
    >
      <div ref={worldLayerRef} className="world-layer">
        <div className="cork-plane" style={{ left: -WORLD_SIZE / 2, top: -WORLD_SIZE / 2, width: WORLD_SIZE, height: WORLD_SIZE }} />

      <div className="world">
        {ropeItems.length > 0 && (
          <>
            {/* Strings: behind the notes, like real pinned string. */}
            <svg
              className="ropes"
              viewBox={`${-WORLD_SIZE / 2} ${-WORLD_SIZE / 2} ${WORLD_SIZE} ${WORLD_SIZE}`}
              style={{ left: -WORLD_SIZE / 2, top: -WORLD_SIZE / 2, width: WORLD_SIZE, height: WORLD_SIZE }}
            >
              {ropeItems.map(({ l, type, geo, fresh }) => (
                <g
                  key={l.id}
                  className={`rope ${fresh ? 'rope-new' : ''}`}
                  data-from={l.from}
                  data-to={l.to}
                >
                  <path className="rope-shadow" pathLength="1" d={geo.d} />
                  <path
                    className="rope-line"
                    pathLength="1"
                    d={geo.d}
                    style={{ stroke: type.color, strokeDasharray: type.dashed ? '7 7' : undefined }}
                  />
                  <path
                    className="rope-hit"
                    d={geo.d}
                    onPointerDown={(e) => e.stopPropagation()}
                    onContextMenu={(e) => onCtxLink(e, l)}
                  />
                </g>
              ))}
            </svg>
            {/* Arrowheads + labels: in front so they read clearly. */}
            <svg
              className="rope-marks"
              viewBox={`${-WORLD_SIZE / 2} ${-WORLD_SIZE / 2} ${WORLD_SIZE} ${WORLD_SIZE}`}
              style={{ left: -WORLD_SIZE / 2, top: -WORLD_SIZE / 2, width: WORLD_SIZE, height: WORLD_SIZE }}
            >
              {ropeItems.map(({ l, type, geo }) => {
                const label = l.label || ''
                const labelW = Math.min(240, 26 + label.length * 6.6)
                if (!type.directed && !label) return null
                return (
                  <g key={l.id} className="rope" data-from={l.from} data-to={l.to}>
                    {type.directed ? (
                      <path className="rope-arrow" d={geo.arrow} style={{ fill: type.color }} />
                    ) : null}
                    {label ? (
                      <g className="rope-labelwrap" transform={`translate(${geo.mid.x} ${geo.mid.y})`}>
                        <rect className="rope-label-bg" x={-labelW / 2} y={-11} width={labelW} height={20} rx={4} />
                        <text className="rope-label" textAnchor="middle" y={4}>{label}</text>
                      </g>
                    ) : null}
                  </g>
                )
              })}
            </svg>
          </>
        )}

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
                onLiveHeight={onLiveHeight}
                onMoveEnd={() => {}}
                onDrop={onFanDrop}
                onDragMove={onDragMove}
                onAddClip={onAddClip}
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
            mode={mode}
            linkSource={linkFrom === note.id}
            connections={selected === note.id ? connections : null}
            tick={tick}
            getZoom={getZoom}
            onSelect={onSelect}
            onChange={onChange}
            onLiveHeight={onLiveHeight}
            onMoveEnd={onMoveEnd}
            onDragMove={onDragMove}
            onAddClip={onAddClip}
            onLinkClick={onLinkClick}
            onOpenLink={onOpenLink}
            onContextMenu={onCtxItem}
          />
        ))}

        {clips.map((clip) => (
          <ClipView
            key={clip.id}
            item={clip}
            selected={selected === clip.id}
            getZoom={getZoom}
            onSelect={onSelect}
            onMoveEnd={onClipMoveEnd}
            onResizeEnd={onClipResizeEnd}
            onContextMenu={onCtxItem}
          />
        ))}

        {music.map((item) => (
          <MusicView
            key={item.id}
            item={item}
            selected={selected === item.id}
            getZoom={getZoom}
            onSelect={onSelect}
            onMoveEnd={onMusicMoveEnd}
            onResizeEnd={onMusicResizeEnd}
            onContextMenu={onCtxItem}
          />
        ))}

        {cards.map((card) => (
          <CardView
            key={card.id}
            item={card}
            selected={selected === card.id}
            getZoom={getZoom}
            onSelect={onSelect}
            onMoveEnd={onCardMoveEnd}
            onResizeEnd={onCardResizeEnd}
            onOpen={onOpenCard}
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
            onEditLocation={onEditLocation}
            onResizeLocation={onResizeLocation}
            onContextMenu={onCtxItem}
          />
        ))}
      </div>
      </div>
    </div>
  )
}