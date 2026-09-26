import React, { memo, useRef } from 'react'
import { pointerSelect, startGroupDrag } from './drag.js'
import { stackZ } from './stack.js'

const PALETTE = ['#c0612f', '#3a7bd5', '#5a9e5a', '#c9a227', '#8a6dc9', '#d64545', '#2aa198', '#b5651d']

function fmt(n) {
  if (!isFinite(n)) return ''
  return Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : String(Math.round(n * 100) / 100)
}

// Draws a bar / line / pie chart as inline SVG (no chart library).
export function ChartSvg({ item, width, height }) {
  const data = (item.data || []).filter((d) => d && d.label != null && isFinite(d.value))
  const kind = item.kind || 'bar'
  const w = Math.max(40, width)
  const h = Math.max(40, height)

  if (!data.length) {
    return (
      <svg className="chart-svg" viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <text x={w / 2} y={h / 2} textAnchor="middle" className="chart-empty">Add data…</text>
      </svg>
    )
  }

  if (kind === 'pie') {
    const total = data.reduce((s, d) => s + Math.max(0, d.value), 0) || 1
    const cx = w / 2
    const cy = h / 2
    const r = Math.max(18, Math.min(w, h) / 2 - 14)
    let a0 = -Math.PI / 2
    return (
      <svg className="chart-svg" viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        {data.map((d, i) => {
          const frac = Math.max(0, d.value) / total
          const a1 = a0 + frac * Math.PI * 2
          const x0 = cx + Math.cos(a0) * r
          const y0 = cy + Math.sin(a0) * r
          const x1 = cx + Math.cos(a1) * r
          const y1 = cy + Math.sin(a1) * r
          const large = frac > 0.5 ? 1 : 0
          const dPath = frac >= 0.999
            ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
            : `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`
          a0 = a1
          return <path key={i} d={dPath} fill={PALETTE[i % PALETTE.length]} stroke="#fffdf7" strokeWidth="1.5" />
        })}
      </svg>
    )
  }

  const padL = 34, padR = 12, padT = 12, padB = 24
  const iw = Math.max(10, w - padL - padR)
  const ih = Math.max(10, h - padT - padB)
  const vals = data.map((d) => d.value)
  const max = Math.max(0, ...vals)
  const min = Math.min(0, ...vals)
  const range = (max - min) || 1
  const yFor = (v) => padT + ih - ((v - min) / range) * ih
  const y0 = yFor(0)
  const step = iw / data.length
  const xFor = (i) => padL + step * (i + 0.5)
  const gridVals = [max, max - range / 2, min]

  return (
    <svg className="chart-svg" viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
      {gridVals.map((v, i) => (
        <g key={i}>
          <line x1={padL} y1={yFor(v)} x2={w - padR} y2={yFor(v)} stroke="rgba(90,74,48,0.16)" strokeWidth="1" />
          <text x={padL - 6} y={yFor(v) + 3} textAnchor="end" className="chart-axis">{fmt(v)}</text>
        </g>
      ))}
      {kind === 'line' ? (
        <>
          <polyline
            className="chart-line"
            points={data.map((d, i) => `${xFor(i)},${yFor(d.value)}`).join(' ')}
            fill="none"
            stroke={PALETTE[0]}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {data.map((d, i) => (
            <circle key={i} cx={xFor(i)} cy={yFor(d.value)} r="3.4" fill="#fffdf7" stroke={PALETTE[0]} strokeWidth="2" />
          ))}
        </>
      ) : (
        data.map((d, i) => {
          const bw = Math.max(4, step * 0.62)
          const top = Math.min(yFor(d.value), y0)
          const bh = Math.max(1.5, Math.abs(yFor(d.value) - y0))
          return (
            <rect
              key={i}
              x={xFor(i) - bw / 2}
              y={top}
              width={bw}
              height={bh}
              rx="2"
              fill={PALETTE[i % PALETTE.length]}
            />
          )
        })
      )}
      <line x1={padL} y1={y0} x2={w - padR} y2={y0} stroke="rgba(90,74,48,0.55)" strokeWidth="1.2" />
      {data.length <= 8 && data.map((d, i) => (
        <text key={i} x={xFor(i)} y={h - 8} textAnchor="middle" className="chart-axis">{String(d.label).slice(0, 7)}</text>
      ))}
    </svg>
  )
}

export default memo(function ChartView({
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
    const st = { moved: false, x: item.x, y: item.y }
    drag.current = st
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
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  function startResize(e, edge) {
    e.preventDefault()
    e.stopPropagation()
    const startW = item.w, startH = item.h, startX = item.x, startY = item.y
    const start = { sx: e.clientX, sy: e.clientY }
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const calc = (ev) => {
      const scale = getZoom()
      const dx = (ev.clientX - start.sx) / scale
      const dy = (ev.clientY - start.sy) / scale
      let nw = startW, nh = startH, nx = startX, ny = startY
      if (edge.includes('e')) nw = Math.max(200, startW + dx)
      if (edge.includes('w')) { nw = Math.max(200, startW - dx); nx = startX + (startW - nw) }
      if (edge.includes('s')) nh = Math.max(160, startH + dy)
      if (edge.includes('n')) { nh = Math.max(160, startH - dy); ny = startY + (startH - nh) }
      return { nw, nh, nx, ny }
    }
    const onMove = (ev) => {
      const { nw, nh, nx, ny } = calc(ev)
      if (wrapRef.current) {
        wrapRef.current.style.width = nw + 'px'
        wrapRef.current.style.height = nh + 'px'
        wrapRef.current.style.left = nx + 'px'
        wrapRef.current.style.top = ny + 'px'
      }
    }
    const onUp = (ev) => {
      const { nw, nh, nx, ny } = calc(ev)
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
      className={`chart-card ${selected ? 'chart-card-selected' : ''}`}
      style={{ left: item.x, top: item.y, width: item.w, height: item.h, zIndex: stackZ(item, 11, selected) }}
      onPointerDown={startDrag}
      onDoubleClick={(e) => { e.stopPropagation(); if (onOpen) onOpen(item) }}
      onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); e.stopPropagation(); onContextMenu(e, item, 'chart') } }}
    >
      <div className="chart-head">
        <span className="chart-title">{item.title || 'Chart'}</span>
        <span className="chart-kind">{(item.kind || 'bar').toUpperCase()}</span>
      </div>
      <div className="chart-body">
        <ChartSvg item={item} width={item.w - 16} height={item.h - 40} />
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
