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
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 4 } },
    })
  }
  return client
}

// The single shared board row is addressed by a fixed 24-char id (see db/init.sql).
// Kept exported so store.js and any caller use one constant.
export const BOARD_ROW_ID = 'board-0000-0000-000000000001'
