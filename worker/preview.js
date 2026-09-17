// Link preview: fetches a page server-side and extracts Open Graph metadata so
// the client can render a rich article card without CORS problems.

import { json } from './auth.js'

// Block obvious SSRF targets: local/private hosts, raw IPs, and metadata IPs.
function isBlockedHost(host) {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h === 'metadata.google.internal' || h === 'metadata') return true
  if (h.includes(':') || h.startsWith('[')) return true // IPv6 literal
  if (/^[0-9.]+$/.test(h)) return true // any raw IPv4
  return false
}

function decode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function metaContent(html, key) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
    'i'
  )
  const tag = html.match(re)
  if (!tag) return ''
  const c = tag[0].match(/content\s*=\s*["']([^"']*)["']/i)
  return c ? decode(c[1]).trim() : ''
}

function firstMatch(html, re) {
  const m = html.match(re)
  return m ? decode(m[1]).trim() : ''
}

export async function handleLinkPreview(request, env, ctx) {
  const target = new URL(request.url).searchParams.get('url')
  if (!target) return json({ error: 'Missing url' }, 400)

  let u
  try { u = new URL(target) } catch (e) { return json({ error: 'Invalid url' }, 400) }
  if (!['http:', 'https:'].includes(u.protocol)) return json({ error: 'Only http(s) links are supported' }, 400)
  if (isBlockedHost(u.hostname)) return json({ error: 'That link is not allowed' }, 400)

  const cacheKey = new Request(`https://link-preview.cache/?u=${encodeURIComponent(u.href)}`)
  try {
    const hit = await caches.default.match(cacheKey)
    if (hit) {
      return new Response(hit.body, { headers: { 'Content-Type': 'application/json' } })
    }
  } catch (e) { /* cache optional */ }

  let res
  try {
    res = await fetch(u.href, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MyBoardBot/1.0; +link-preview)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    })
  } catch (e) {
    return json({ error: 'Could not reach that link' }, 502)
  }
  if (!res.ok) return json({ error: `Link returned ${res.status}` }, 502)

  const type = res.headers.get('content-type') || ''
  if (!/text\/html|application\/xhtml/i.test(type)) {
    return json({ error: 'That link is not a web page' }, 415)
  }

  // Read at most ~300 KB of HTML.
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let html = ''
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.length
    html += decoder.decode(value, { stream: true })
    if (received > 300000) { try { await reader.cancel() } catch (e) {} break }
  }

  const finalUrl = res.url || u.href
  const base = new URL(finalUrl)
  const title = metaContent(html, 'og:title') || firstMatch(html, /<title[^>]*>([^<]*)<\/title>/i)
  const description = metaContent(html, 'og:description') || metaContent(html, 'description')
  const siteName = metaContent(html, 'og:site_name') || base.hostname.replace(/^www\./, '')

  let image = metaContent(html, 'og:image') || metaContent(html, 'twitter:image')
  if (image) { try { image = new URL(image, base).href } catch (e) { image = '' } }

  let favicon = ''
  const iconTag = html.match(/<link[^>]+rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*>/i)
  if (iconTag) {
    const href = iconTag[0].match(/href\s*=\s*["']([^"']+)["']/i)
    if (href) { try { favicon = new URL(href[1], base).href } catch (e) {} }
  }
  if (!favicon) favicon = new URL('/favicon.ico', base).href

  const payload = {
    url: finalUrl,
    title: title || base.hostname,
    description,
    image,
    favicon,
    siteName,
  }
  const body = JSON.stringify(payload)
  if (ctx && ctx.waitUntil) {
    try {
      ctx.waitUntil(caches.default.put(cacheKey, new Response(body, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=86400' },
      })))
    } catch (e) { /* ignore */ }
  }
  return new Response(body, { headers: { 'Content-Type': 'application/json' } })
}
