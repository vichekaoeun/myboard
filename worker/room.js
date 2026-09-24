// One Durable Object per account (and per shared board). Holds the live
// WebSocket connections for that room, broadcasts a "changed" ping when the
// board is saved, and tracks who is present so clients can show collaborators.
//
// Identity is carried in the socket URL as query params (uid/kind/name). It is
// display-only — the HTTP endpoints still enforce real access control.

export class Room {
  constructor(state, env) {
    this.state = state
    this.env = env
    this.sessions = new Map() // WebSocket -> peer
    this.maxGuests = 0 // 0 = unlimited; set per owner plan before a guest joins
  }

  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname.endsWith('/notify')) {
      this.broadcast('changed')
      return new Response('ok')
    }

    // The API sets the concurrent-guest cap for this board before a guest's
    // socket connects (free owner = 1, Pro = unlimited).
    if (url.pathname.endsWith('/config')) {
      let body = {}
      try { body = await request.json() } catch (e) {}
      this.maxGuests = Number(body.maxGuests) || 0
      return new Response('ok')
    }

    if ((request.headers.get('Upgrade') || '').toLowerCase() === 'websocket') {
      const peer = {
        id: clean(url.searchParams.get('uid'), 64) || crypto.randomUUID(),
        kind: url.searchParams.get('kind') === 'user' ? 'user' : 'guest',
        name: clean(url.searchParams.get('name'), 40),
      }
      if (peer.kind === 'guest' && !peer.name) {
        const seq = ((await this.state.storage.get('guestSeq')) || 0) + 1
        await this.state.storage.put('guestSeq', seq)
        peer.name = 'Guest ' + seq
      }
      if (!peer.name) peer.name = peer.kind === 'user' ? 'Someone' : 'Guest'
      peer.color = colorFor(peer.id)

      const pair = new WebSocketPair()
      // Free boards allow one guest at a time; tell extras and close.
      if (peer.kind === 'guest' && this.guestsFull()) {
        pair[1].accept()
        try { pair[1].send(JSON.stringify({ t: 'full' })) } catch (e) {}
        try { pair[1].close(4000, 'full') } catch (e) {}
        return new Response(null, { status: 101, webSocket: pair[0] })
      }
      this.accept(pair[1], peer)
      return new Response(null, { status: 101, webSocket: pair[0] })
    }

    return new Response('Not found', { status: 404 })
  }

  guestsFull() {
    const max = this.maxGuests
    if (!max) return false
    let guests = 0
    for (const p of this.sessions.values()) if (p.kind === 'guest') guests++
    return guests >= max
  }

  accept(server, peer) {
    server.accept()
    this.sessions.set(server, peer)

    const drop = () => {
      if (!this.sessions.has(server)) return
      this.sessions.delete(server)
      this.broadcast(JSON.stringify({ t: 'activity', what: 'left', peer }))
      this.sendPresence()
    }
    server.addEventListener('close', drop)
    server.addEventListener('error', drop)
    server.addEventListener('message', (ev) => {
      let msg = null
      try { msg = JSON.parse(ev.data) } catch (e) { return }
      if (!msg) return
      if (msg.t === 'activity') {
        const what = clean(msg.what, 20) || 'edited'
        this.broadcast(JSON.stringify({ t: 'activity', what, peer }))
      } else if (msg.t === 'cursor') {
        const wx = Number(msg.wx)
        const wy = Number(msg.wy)
        const sel = Array.isArray(msg.sel) ? msg.sel.filter((s) => typeof s === 'string').slice(0, 25) : []
        if (!isFinite(wx) || !isFinite(wy)) return
        this.broadcast(JSON.stringify({ t: 'cursor', peer, wx, wy, sel }))
      }
    })

    this.broadcast(JSON.stringify({ t: 'activity', what: 'joined', peer }))
    this.sendPresence()
  }

  sendPresence() {
    this.broadcast(JSON.stringify({ t: 'presence', peers: [...this.sessions.values()] }))
  }

  broadcast(data) {
    for (const ws of [...this.sessions.keys()]) {
      try { ws.send(data) } catch (e) { this.sessions.delete(ws) }
    }
  }
}

function clean(v, max) {
  if (typeof v !== 'string') return ''
  return v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max)
}

// Stable display colour derived from the peer id.
function colorFor(id) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return `hsl(${h} 58% 52%)`
}
