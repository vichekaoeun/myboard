// Supabase client — guarded & lazy.
// This file runs in the browser, so it ONLY ever receives the publishable
// (anon) key + project URL from Vite env. db_password is intentionally NOT a
// VITE_ var and therefore never ships to the client bundle; it is server-only.

import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

let client = null

export function hasSupabase() {
  return !!(url && anon)
}

// Lazily hydrate the singleton. Returns null when not configured so callers
// can fall back to local-only mode without any error noise.
export function getSupabase() {
  if (!hasSupabase()) return null
  if (!client) {
    client = createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: { params: { eventsPerSecond: 4 } },
    })
  }
  return client
}

// The single shared board row is addressed by a fixed 24-char id (see db/init.sql).
// Kept exported so store.js and any caller use one constant.
export const BOARD_ROW_ID = 'board-0000-0000-000000000001'

// ---- auth ------------------------------------------------------------------

export async function getSession() {
  const sup = getSupabase()
  if (!sup) return null
  try {
    const { data } = await sup.auth.getSession()
    return data.session || null
  } catch (e) {
    return null
  }
}

export function onAuthChange(cb) {
  const sup = getSupabase()
  if (!sup) return () => {}
  const { data } = sup.auth.onAuthStateChange((_event, session) => cb(session))
  return () => {
    try { data.subscription.unsubscribe() } catch (e) {}
  }
}

export function signInWithGoogle() {
  const sup = getSupabase()
  if (!sup) return Promise.resolve({ error: { message: 'Cloud is not configured' } })
  return sup.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  })
}

export function signInWithEmail(email) {
  const sup = getSupabase()
  if (!sup) return Promise.resolve({ error: { message: 'Cloud is not configured' } })
  return sup.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  })
}

export function signOut() {
  const sup = getSupabase()
  if (!sup) return Promise.resolve()
  return sup.auth.signOut()
}

// Public GoTrue settings endpoint: tells us which sign-in providers are turned
// on, so the UI never shows a provider that would fail with "not enabled".
export async function getAuthProviders() {
  if (!hasSupabase()) return null
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anon } })
    if (!res.ok) return null
    const data = await res.json()
    return data.external || null
  } catch (e) {
    return null
  }
}
