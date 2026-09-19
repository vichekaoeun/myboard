import React, { memo, useEffect, useRef, useState } from 'react'
import { pointerSelect, startGroupDrag } from './drag.js'
import { stackZ } from './stack.js'

export default memo(function MusicView({ item, selected, primary, getZoom, onPointerSelect, onMoveEnd, onResizeEnd, onContextMenu }) {
  const wrapRef = useRef(null)
  const audioRef = useRef(null)
  const drag = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [audioError, setAudioError] = useState(false)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onLoaded = () => setDuration(audio.duration || 0)
    const onTime = () => setProgress(audio.currentTime || 0)
    const onEnded = () => setPlaying(false)
    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('ended', onEnded)
    }
  }, [])

  function togglePlay(e) {
    e.stopPropagation()
    const audio = audioRef.current
    if (!audio) return
    setAudioError(false)
    if (audio.paused) {
      audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    } else {
      audio.pause()
      setPlaying(false)
    }
  }

  function seek(e) {
    e.stopPropagation()
    const audio = audioRef.current
    if (!audio || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * duration
    setProgress(audio.currentTime)
  }

  function startDrag(e) {
    if (e.button !== undefined && e.button !== 0) return
    if (e.target.closest('button, input, .music-progress')) return
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
      if (current?.moved) onMoveEnd(item.id, current.x, current.y)
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
      if (edge.includes('e')) nw = Math.max(240, startW + dx)
      if (edge.includes('w')) { nw = Math.max(240, startW - dx); nx = startX + (startW - nw) }
      if (edge.includes('s')) nh = Math.max(130, startH + dy)
      if (edge.includes('n')) { nh = Math.max(130, startH - dy); ny = startY + (startH - nh) }

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
      if (edge.includes('e')) nw = Math.max(240, startW + dx)
      if (edge.includes('w')) { nw = Math.max(240, startW - dx); nx = startX + (startW - nw) }
      if (edge.includes('s')) nh = Math.max(130, startH + dy)
      if (edge.includes('n')) { nh = Math.max(130, startH - dy); ny = startY + (startH - nh) }

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

  const progressPct = duration ? `${(progress / duration) * 100}%` : '0%'
  return (
    <div
      ref={wrapRef}
      data-id={item.id}
      data-playing={playing}
      className={`music-item ${selected ? 'music-selected' : ''}`}
      style={{ left: item.x, top: item.y, width: item.w, height: item.h, zIndex: stackZ(item, 13, selected) }}
      onPointerDown={startDrag}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, item, 'music') }}
    >
      <audio ref={audioRef} src={item.url} preload="metadata" onError={() => { setPlaying(false); setAudioError(true) }} />
      <div className="cassette-tape" aria-hidden="true"><span /><span /></div>
      <div className="music-label">{item.title || 'Untitled mixtape'}</div>
      <div className="music-controls" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="music-play" onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="1" width="3" height="10" rx="0.5" fill="currentColor" /><rect x="7" y="1" width="3" height="10" rx="0.5" fill="currentColor" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12"><polygon points="3,1 10,6 3,11" fill="currentColor" /></svg>
          )}
        </button>
        <div className="music-progress" onClick={seek}><span style={{ width: progressPct }} /></div>
        <span className="music-time">{formatTime(progress)}</span>
      </div>
      <input className="music-volume" type="range" min="0" max="1" step="0.01" defaultValue="0.8" aria-label="Volume" onPointerDown={(e) => e.stopPropagation()} onChange={(e) => { if (audioRef.current) audioRef.current.volume = Number(e.target.value) }} />
      {audioError && <div className="music-error">Audio could not be played</div>}
      {primary && (
        <div className="music-resize">
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

function formatTime(value) {
  if (!Number.isFinite(value)) return '0:00'
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`
}
