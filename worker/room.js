// One Durable Object per account. Holds the live WebSocket connections for that
// account and broadcasts a "changed" ping whenever the board is saved, so other
// open devices re-pull the latest board.

export class Room {
  constructor(state, env) {
    this.state = state
    this.env = env
    this.sessions = new Set()
  }

  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname.endsWith('/notify')) {
      for (const ws of this.sessions) {
        try { ws.send('changed') } catch (e) { this.sessions.delete(ws) }
      }
      return new Response('ok')
    }

    if ((request.headers.get('Upgrade') || '').toLowerCase() === 'websocket') {
      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]
      this.accept(server)
      return new Response(null, { status: 101, webSocket: client })
    }

    return new Response('Not found', { status: 404 })
  }

  accept(server) {
    server.accept()
    this.sessions.add(server)
    const drop = () => this.sessions.delete(server)
    server.addEventListener('close', drop)
    server.addEventListener('error', drop)
    server.addEventListener('message', () => { /* client -> server unused */ })
  }
}
