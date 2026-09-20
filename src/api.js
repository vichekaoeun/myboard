// Client for the Cloudflare Worker backend (auth + board + realtime).

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')

async function req(method, path, body) {
  let res
  try {
    res = await fetch(API_BASE + path, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    return { error: { message: 'Network error' } }
  }
  let data = null
  try { data = await res.json() } catch (e) {}
  if (!res.ok) {
    return {
      error: {
        code: (data && data.error) || 'error',
        message: (data && (data.message || data.error)) || res.statusText,
        status: res.status,
      },
    }
  }
  return data || {}
}

export function apiMe() {
  return req('GET', '/api/me')
}

export function apiConfig() {
  return req('GET', '/api/config')
}

export function apiRequestMagicLink(email) {
  return req('POST', '/api/auth/email', { email })
}

export function apiLogout() {
  return req('POST', '/api/auth/logout')
}

export function apiLoginWithGoogle() {
  window.location.assign(API_BASE + '/api/auth/google')
}

export function apiListBoards() {
  return req('GET', '/api/boards')
}

export function apiCreateBoard(name) {
  return req('POST', '/api/boards', { name })
}

export function apiGetBoard(id) {
  return req('GET', `/api/boards/${id}`)
}

export function apiPutBoard(id, payload) {
  return req('PUT', `/api/boards/${id}`, { payload })
}

export function apiRenameBoard(id, name) {
  return req('PATCH', `/api/boards/${id}`, { name })
}

export function apiDeleteBoard(id) {
  return req('DELETE', `/api/boards/${id}`)
}

export function apiLinkPreview(url) {
  return req('GET', `/api/link-preview?url=${encodeURIComponent(url)}`)
}

// Live updates: the Worker pings "changed" whenever this account's board is
// saved elsewhere, and we simply re-pull. Auto-reconnects while mounted.
export function apiOpenSocket(onChange) {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const host = API_BASE ? new URL(API_BASE, window.location.href).host : window.location.host
  let ws = null
  let closed = false

  const connect = () => {
    if (closed) return
    try {
      ws = new WebSocket(`${proto}://${host}/api/ws`)
      ws.onmessage = () => onChange()
      ws.onclose = () => { if (!closed) setTimeout(connect, 3000) }
      ws.onerror = () => { try { ws.close() } catch (e) {} }
    } catch (e) {
      setTimeout(connect, 3000)
    }
  }
  connect()

  return () => {
    closed = true
    if (ws) { ws.onclose = null; try { ws.close() } catch (e) {} }
  }
}
