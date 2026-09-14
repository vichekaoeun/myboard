import React, { memo, useEffect, useRef } from 'react'
import { PushPin } from './art.jsx'
import { NOTE_COLORS, NOTE_LINE } from './store.js'

export default memo(function NoteView({
  item, x, y, scale = 1, rotation, tick,
  selected, mode, getZoom,
  onSelect, onChange, onMoveEnd, onDrop, onDragMove, onContextMenu, z,
}) {
  const wrapRef = useRef(null)
  const paperRef = useRef(null)
  const edRef = useRef(null)
  const lastHTML = useRef(null)
  const drag = useRef(null)

  // Restore position after a fan snap-back (tick changes without item change).
  useEffect(() => {
    const w = wrapRef.current
    if (w && !drag.current) {
      w.style.left = x + 'px'
      w.style.top = y + 'px'
    }
  }, [x, y, tick])

  // set editor content when external text changes (initial mount, undo, import)
  useEffect(() => {
    const ed = edRef.current
    if (ed && lastHTML.current !== (item.text || '')) {
      ed.innerHTML = item.text || ''
      lastHTML.current = item.text || ''
    }
  }, [item.text])

  useEffect(() => {
    const paper = paperRef.current
    const wrap = wrapRef.current
    if (!paper || !wrap) return
    const ro = new ResizeObserver(() => {
      const measured = Math.max(90, Math.round(paper.offsetHeight))
      if (Math.abs(measured - (item.h || 0)) > 6) onChange(item.id, { h: measured })
    })
    ro.observe(paper)
    return () => ro.disconnect()
  }, [item.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function commit() {
    const ed = edRef.current
    if (!ed) return
    const text = ed.innerHTML
    if (text !== lastHTML.current) {
      lastHTML.current = text
      onChange(item.id, { text })
    }
  }

  function startDrag(e) {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    onSelect(item.id)
    const scale = getZoom()
    const start = { sx: e.clientX, sy: e.clientY, x, y }
    const movedRef = { moved: false, x, y }
    drag.current = movedRef
    e.currentTarget.setPointerCapture(e.pointerId)

    const onMove = (ev) => {
      const d = drag.current
      if (!d) return
      const s = getZoom()
      const dx = (ev.clientX - start.sx) / s
      const dy = (ev.clientY - start.sy) / s
      if (!d.moved && Math.hypot(dx, dy) > 3 / s) d.moved = true
      d.x = start.x + dx
      d.y = start.y + dy
      const w = wrapRef.current
      if (w) {
        w.style.left = d.x + 'px'
        w.style.top = d.y + 'px'
      }
      if (onDragMove) onDragMove(item.id, d.x, d.y)
    }
    const onUp = (ev) => {
      ev.currentTarget.removeEventListener('pointermove', onMove)
      ev.currentTarget.removeEventListener('pointerup', onUp)
      if (ev.currentTarget.releasePointerCapture) { try { ev.currentTarget.releasePointerCapture(ev.pointerId) } catch (_) {} }
      const d = drag.current
      drag.current = null
      if (!d) return
      if (!d.moved) {
        onSelect(item.id)
        return
      }
      if (mode === 'fan') {
        onDrop(item.id, d.x, d.y)
      } else {
        onMoveEnd(item.id, d.x, d.y)
      }
    }
    e.currentTarget.addEventListener('pointermove', onMove)
    e.currentTarget.addEventListener('pointerup', onUp)
    e.currentTarget.addEventListener('pointercancel', onUp)
  }

  function startResize(e) {
    e.preventDefault()
    e.stopPropagation()
    const sc = getZoom()
    const startW = item.w
    const startH = item.h || 300
    const start = { sx: e.clientX, sy: e.clientY }
    const onMove = (ev) => {
      const ns = getZoom()
      const nw = Math.max(150, startW + (ev.clientX - start.sx) / ns)
      const nh = Math.max(110, startH + (ev.clientY - start.sy) / ns)
      const w = wrapRef.current
      if (w) {
        w.style.width = nw + 'px'
        w.style.height = nh + 'px'
      }
    }
    const onUp = (ev) => {
      const ns = getZoom()
      const nw = Math.max(150, startW + (ev.clientX - start.sx) / ns)
      const nh = Math.max(110, startH + (ev.clientY - start.sy) / ns)
      ev.currentTarget.removeEventListener('pointermove', onMove)
      ev.currentTarget.removeEventListener('pointerup', onUp)
      if (ev.currentTarget.releasePointerCapture) { try { ev.currentTarget.releasePointerCapture(ev.pointerId) } catch (_) {} }
      onChange(item.id, { w: Math.round(nw), h: Math.round(nh) })
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.addEventListener('pointermove', onMove)
    e.currentTarget.addEventListener('pointerup', onUp)
  }

  function beginLink() {
    const url = window.prompt('Paste the link address (https://…)')
    if (!url) return
    const ok = document.execCommand('createLink', false, url.trim())
    if (ok) {
      const ed = edRef.current
      if (ed) ed.querySelectorAll('a').forEach((a) => { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noreferrer') })
      commit()
    }
  }

  function openLink(e) {
    const a = e.target.closest('a')
    if (a && a.href) {
      e.preventDefault()
      window.open(a.href, '_blank', 'noopener')
    }
  }

  function insertImage(url) {
    const ed = edRef.current
    if (!ed) return
    ed.focus()
    document.execCommand('insertHTML', false, `<span contenteditable="false"><img class="note-img" src="${url}" /></span>`)
    commit()
  }

  function pickImage(e) {
    e.preventDefault()
    e.stopPropagation()
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files && input.files[0]
      if (!file) return
      const url = await downscale(file)
      insertImage(url)
    }
    input.click()
  }

  function handleDrop(e) {
    e.preventDefault()
    e.stopPropagation()
    if (!e.dataTransfer) return
    const file = [...(e.dataTransfer.files || [])].find((f) => f.type && f.type.startsWith('image/'))
    if (file) {
      downscale(file).then(insertImage)
      return
    }
    const text = e.dataTransfer.getData('text/plain')
    if (text) {
      const ed = edRef.current
      if (ed) ed.focus()
      document.execCommand('insertText', false, text)
      commit()
    }
  }

  function handlePaste(e) {
    if (!e.clipboardData) return
    const files = [...(e.clipboardData.files || [])].filter((f) => f.type && f.type.startsWith('image/'))
    if (files.length) {
      e.preventDefault()
      downscale(files[0]).then(insertImage)
    }
  }

  const color = NOTE_COLORS[item.color] || NOTE_COLORS.white
  const line = NOTE_LINE[item.color] || NOTE_LINE.white

  const base = {
    left: x,
    top: y,
    width: item.w * scale,
    transformOrigin: 'center',
    transform: `rotate(${rotation || 0}deg)`,
    zIndex: z ?? (selected ? 40 : 10),
  }

  return (
    <div ref={wrapRef} data-id={item.id} className={`note ${selected ? 'note-selected' : ''} note-${item.color}`} style={base} onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); e.stopPropagation(); onContextMenu(e, item, 'note') } }}>
      <div
        className="scale-layer"
        style={{ width: item.w, transform: scale === 1 ? undefined : `scale(${scale})`, transformOrigin: '0 0' }}
      >
        <div ref={paperRef} className="note-paper note-paper-colored" style={{ background: color }} onPointerDown={(e) => { e.stopPropagation(); onSelect(item.id) }}>
          <div className="note-ruled" style={ruledStyle(line, item.color)} />
          <div
            ref={edRef}
            className="note-ed"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            data-placeholder="Jot something down…"
            onClick={openLink}
            onInput={commit}
            onBlur={commit}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') e.currentTarget.blur()
            }}
          />
          <div className="note-pin-handle" onPointerDown={startDrag} onClick={(e) => { e.stopPropagation(); onSelect(item.id) }}>
            <PushPin color="#e95d5d" size={Math.max(26, 34)} />
          </div>
          {selected && mode !== 'fan' && (
            <div className="note-formatbar" onMouseDown={(e) => e.preventDefault()}>
              <button title="Bold" onClick={() => { document.execCommand('bold'); commit() }}><b>B</b></button>
              <button title="Italic" onClick={() => { document.execCommand('italic'); commit() }}><i>I</i></button>
              <button title="Add a link" onClick={beginLink}><span className="fmt-link">↗</span></button>
              <button title="Attach an image" onClick={pickImage}><span className="fmt-img">▧</span></button>
            </div>
          )}
          {selected && mode !== 'fan' && <div className="note-resize" onPointerDown={startResize} />}
        </div>
      </div>
    </div>
  )
})

function ruledStyle(lineColor, noteColor) {
  return {
    backgroundImage: `linear-gradient(${lineColor} 1px, transparent 1px)`,
  }
}

async function downscale(file) {
  const maxDim = 1500
  const { width, height } = await readSize(file)
  const scaleF = Math.min(1, maxDim / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scaleF))
  canvas.height = Math.max(1, Math.round(height * scaleF))
  const ctx = canvas.getContext('2d')
  if (/\.png$/i.test(file.name) || file.type === 'image/png') {
    ctx.drawImage(await loadImg(file), 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  }
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(await loadImg(file), 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.84)
}

function loadImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = reject
    img.src = url
  })
}

function readSize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.width, height: img.height }) }
    img.onerror = reject
    img.src = url
  })
}