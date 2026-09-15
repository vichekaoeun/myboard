import React, { memo, useEffect, useRef } from 'react'
import { PushPin } from './art.jsx'
import { NOTE_COLORS } from './store.js'
import { updateRopesForNote } from './ropes.js'

function noteTitle(n) {
  const t = (n.text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return 'Untitled note'
  return t.length > 42 ? t.slice(0, 42).trimEnd() + '…' : t
}

export default memo(function NoteView({
  item, x, y, scale = 1, rotation, tick,
  selected, mode, getZoom, linkSource, connections,
  onSelect, onChange, onLiveHeight, onMoveEnd, onDrop, onDragMove, onContextMenu, z,
  onAddClip, onLinkClick, onOpenLink,
}) {
  const wrapRef = useRef(null)
  const paperRef = useRef(null)
  const edRef = useRef(null)
  const lastHTML = useRef(null)
  const drag = useRef(null)
  const selectionRef = useRef(null)

  useEffect(() => {
    const w = wrapRef.current
    if (w && !drag.current) {
      w.style.left = x + 'px'
      w.style.top = y + 'px'
    }
  }, [x, y, tick])

  useEffect(() => {
    const ed = edRef.current
    if (ed && lastHTML.current !== (item.text || '')) {
      ed.innerHTML = item.text || ''
      lastHTML.current = item.text || ''
    }
  }, [item.text])

  const lastH = useRef(0)
  useEffect(() => { lastH.current = item.h || 0 }, [item.h])

  useEffect(() => {
    const paper = paperRef.current
    if (!paper || !onLiveHeight) return
    const ro = new ResizeObserver(() => {
      const measured = Math.max(90, Math.round(paper.offsetHeight))
      if (Math.abs(measured - lastH.current) > 6) {
        lastH.current = measured
        onLiveHeight(item.id, { h: measured })
      }
    })
    ro.observe(paper)
    return () => ro.disconnect()
  }, [item.id, onLiveHeight])

  function commit() {
    const ed = edRef.current
    if (!ed) return
    const text = ed.innerHTML
    if (text !== lastHTML.current) {
      lastHTML.current = text
      onChange(item.id, { text })
    }
  }

  function rememberSelection() {
    const ed = edRef.current
    const selection = window.getSelection()
    if (!ed || !selection || !selection.rangeCount || !ed.contains(selection.anchorNode)) return
    selectionRef.current = selection.getRangeAt(0).cloneRange()
  }

  function restoreSelection() {
    const ed = edRef.current
    const range = selectionRef.current
    if (!ed || !range) return false
    ed.focus()
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    return true
  }

  function format(command, value = null) {
    restoreSelection()
    document.execCommand('styleWithCSS', false, true)
    document.execCommand(command, false, value)
    rememberSelection()
    commit()
  }

  function startDrag(e) {
    if (e.button !== undefined && e.button !== 0) return
    if (mode === 'link' && onLinkClick) {
      e.preventDefault()
      e.stopPropagation()
      onLinkClick(item.id)
      return
    }
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
      updateRopesForNote(item.id, d.x, d.y, item.w)
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

  function startResize(e, edge) {
    e.preventDefault()
    e.stopPropagation()
    const sc = getZoom()
    const startW = item.w
    const startH = item.h || 300
    const startX = item.x
    const startY = item.y
    const start = { sx: e.clientX, sy: e.clientY }

    const onMove = (ev) => {
      const ns = getZoom()
      const dx = (ev.clientX - start.sx) / ns
      const dy = (ev.clientY - start.sy) / ns

      let nw = startW, nh = startH, nx = startX, ny = startY

      if (edge.includes('e')) nw = Math.max(150, startW + dx)
      if (edge.includes('w')) { nw = Math.max(150, startW - dx); nx = startX + (startW - nw) }
      if (edge.includes('s')) nh = Math.max(110, startH + dy)
      if (edge.includes('n')) { nh = Math.max(110, startH - dy); ny = startY + (startH - nh) }

      const w = wrapRef.current
      if (w) {
        w.style.width = nw + 'px'
        w.style.height = nh + 'px'
        w.style.left = nx + 'px'
        w.style.top = ny + 'px'
      }
      const paper = paperRef.current
      if (paper) {
        paper.style.width = nw + 'px'
        paper.style.height = nh + 'px'
      }
      updateRopesForNote(item.id, nx, ny, nw)
    }
    const onUp = (ev) => {
      const ns = getZoom()
      const dx = (ev.clientX - start.sx) / ns
      const dy = (ev.clientY - start.sy) / ns

      let nw = startW, nh = startH, nx = startX, ny = startY
      if (edge.includes('e')) nw = Math.max(150, startW + dx)
      if (edge.includes('w')) { nw = Math.max(150, startW - dx); nx = startX + (startW - nw) }
      if (edge.includes('s')) nh = Math.max(110, startH + dy)
      if (edge.includes('n')) { nh = Math.max(110, startH - dy); ny = startY + (startH - nh) }

      ev.currentTarget.removeEventListener('pointermove', onMove)
      ev.currentTarget.removeEventListener('pointerup', onUp)
      if (ev.currentTarget.releasePointerCapture) { try { ev.currentTarget.releasePointerCapture(ev.pointerId) } catch (_) {} }
      onChange(item.id, { w: Math.round(nw), h: Math.round(nh), sh: Math.round(nh), x: Math.round(nx), y: Math.round(ny) })
      const p = paperRef.current
      if (p) p.style.height = ''
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.addEventListener('pointermove', onMove)
    e.currentTarget.addEventListener('pointerup', onUp)
  }

  function beginLink() {
    const raw = window.prompt('Paste the link address (https://…)')
    if (!raw) return
    let url = raw.trim()
    if (!url) return
    // Add a scheme when the user omits one, otherwise the browser treats the
    // value as a relative URL and the link "goes nowhere".
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
      url = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url) ? `mailto:${url}` : `https://${url}`
    }
    let href
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) throw new Error('unsupported')
      href = parsed.href
    } catch (e) {
      window.alert('That doesn’t look like a valid link. Try something like https://example.com')
      return
    }
    restoreSelection()
    const ok = document.execCommand('createLink', false, href)
    if (ok) {
      const ed = edRef.current
      if (ed) {
        ed.querySelectorAll('a').forEach((a) => {
          a.setAttribute('target', '_blank')
          a.setAttribute('rel', 'noreferrer')
          a.setAttribute('contenteditable', 'false')
        })
      }
      commit()
    }
  }

  function openLink(e) {
    const a = e.target && e.target.closest ? e.target.closest('a') : null
    if (!a) return
    const href = a.getAttribute('href') || ''
    if (!/^(https?:|mailto:|tel:)/i.test(href)) return
    e.preventDefault()
    window.open(href, '_blank', 'noopener')
  }

  function attachImage(url) {
    onAddClip(url, item.x + item.w + 28, item.y + 18)
  }

  function handleDrop(e) {
    e.preventDefault()
    e.stopPropagation()
    if (!e.dataTransfer) return
    const file = [...(e.dataTransfer.files || [])].find((f) => f.type && f.type.startsWith('image/'))
    if (file) {
      downscale(file).then(attachImage)
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
      downscale(files[0]).then(attachImage)
    }
  }

  const color = NOTE_COLORS[item.color] || NOTE_COLORS.white

  const base = {
    left: x,
    top: y,
    width: item.w * scale,
    transformOrigin: 'center',
    transform: `rotate(${rotation || 0}deg)`,
    zIndex: z ?? (selected ? 40 : 10),
  }

  return (
    <div ref={wrapRef} data-id={item.id} className={`note ${selected ? 'note-selected' : ''} ${linkSource ? 'note-link-source' : ''} note-${item.color}`} style={base} onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); e.stopPropagation(); onContextMenu(e, item, 'note') } }}>
      <div
        className="scale-layer"
        style={{ width: item.w, transform: scale === 1 ? undefined : `scale(${scale})`, transformOrigin: '0 0' }}
      >
        <div ref={paperRef} className="note-paper note-paper-colored" style={{ width: item.w, minHeight: item.sh || item.h || 300, background: color }} onPointerDown={(e) => { e.stopPropagation(); if (mode === 'link' && onLinkClick) { e.preventDefault(); onLinkClick(item.id); return } onSelect(item.id) }}>
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
            onKeyUp={rememberSelection}
            onMouseUp={rememberSelection}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') e.currentTarget.blur()
            }}
          />
          <div className="note-drag-edge note-drag-edge-top" onPointerDown={startDrag} />
          <div className="note-drag-edge note-drag-edge-right" onPointerDown={startDrag} />
          <div className="note-drag-edge note-drag-edge-bottom" onPointerDown={startDrag} />
          <div className="note-drag-edge note-drag-edge-left" onPointerDown={startDrag} />
          <div className="note-pin-handle" onPointerDown={startDrag} onClick={(e) => { e.stopPropagation(); if (mode === 'link') return; onSelect(item.id) }}>
            <PushPin color="#e95d5d" size={Math.max(26, 34)} />
          </div>
          {selected && mode !== 'fan' && (
            <div className="note-formatbar" onMouseDown={(e) => {
              rememberSelection()
              if (e.target.tagName !== 'SELECT') e.preventDefault()
            }}>
              <select title="Font family" defaultValue="" onChange={(e) => format('fontName', e.target.value)}>
                <option value="" disabled>Font</option>
                <option value="Caveat">Handwritten</option>
                <option value="Georgia">Serif</option>
                <option value="Arial">Sans</option>
                <option value="Courier New">Mono</option>
              </select>
              <select title="Font size" defaultValue="3" onChange={(e) => format('fontSize', e.target.value)}>
                <option value="1">Small</option>
                <option value="3">Normal</option>
                <option value="5">Large</option>
                <option value="7">Huge</option>
              </select>
              <button title="Bold" onClick={() => format('bold')}><b>B</b></button>
              <button title="Italic" onClick={() => format('italic')}><i>I</i></button>
              <button title="Underline" onClick={() => format('underline')}><u>U</u></button>
              <button title="Strikethrough" onClick={() => format('strikeThrough')}><s>S</s></button>
              <button title="Bulleted list" onClick={() => format('insertUnorderedList')}>•</button>
              <button title="Numbered list" onClick={() => format('insertOrderedList')}>1.</button>
              <button title="Align left" onClick={() => format('justifyLeft')}>≡</button>
              <button title="Center" onClick={() => format('justifyCenter')}>≡</button>
              <button title="Align right" onClick={() => format('justifyRight')}>≡</button>
              <button title="Add a link" onClick={beginLink}><span className="fmt-link">↗</span></button>
              <button title="Clear formatting" onClick={() => format('removeFormat')}>Tx</button>
            </div>
          )}
          {selected && mode !== 'fan' && connections && (connections.from.length > 0 || connections.to.length > 0) && (
            <div className="note-links" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              {connections.from.length > 0 && (
                <>
                  <div className="nl-title">Connected from:</div>
                  <ul className="nl-list">
                    {connections.from.map((n) => (
                      <li key={n.id}>
                        <button type="button" onClick={() => onOpenLink && onOpenLink(n.id)}>“{noteTitle(n)}”</button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {connections.to.length > 0 && (
                <>
                  <div className="nl-title">Links to:</div>
                  <ul className="nl-list">
                    {connections.to.map((n) => (
                      <li key={n.id}>
                        <button type="button" onClick={() => onOpenLink && onOpenLink(n.id)}>“{noteTitle(n)}”</button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          {selected && mode !== 'fan' && (
            <div className="note-resize">
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
      </div>
    </div>
  )
})

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
