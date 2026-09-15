import React, { useEffect, useState } from 'react'
import { GoogleIcon } from './icons.jsx'
import { getAuthProviders } from './supabase.js'

// Full-screen sign-in wall. Shown whenever the app is cloud-backed but the
// visitor is not signed in, so nobody can open or edit a board.
export function AuthGate({ onGoogle, onEmail }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [googleOn, setGoogleOn] = useState(null) // null = unknown (still loading)

  // Only offer Google if the Supabase project actually has it enabled.
  useEffect(() => {
    let active = true
    getAuthProviders().then((p) => { if (active && p) setGoogleOn(!!p.google) })
    return () => { active = false }
  }, [])

  const friendly = (message) => {
    if (!message) return message
    if (/provider is not enabled/i.test(message)) {
      return 'Google sign-in isn’t enabled for this project yet — use the email link below.'
    }
    if (/redirect|url/i.test(message)) {
      return 'This site isn’t in the allowed redirect URLs yet — add it in Supabase → Authentication → URL Configuration.'
    }
    return message
  }

  async function handleGoogle() {
    setError('')
    setBusy(true)
    const message = await onGoogle()
    if (message) {
      setError(friendly(message))
      setBusy(false)
    }
    // On success the browser is redirected to Google, so we stay "busy".
  }

  async function handleEmail(e) {
    e.preventDefault()
    const addr = email.trim()
    if (!addr) return
    setError('')
    setBusy(true)
    const message = await onEmail(addr)
    setBusy(false)
    if (message) setError(friendly(message))
    else setSent(true)
  }

  const showGoogle = googleOn !== false

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <span className="auth-pin" aria-hidden="true" />
        <h1 className="auth-title">My Board</h1>
        <p className="auth-sub">Sign in to open your corkboard.</p>

        {showGoogle && (
          <>
            <button type="button" className="auth-google" onClick={handleGoogle} disabled={busy}>
              <GoogleIcon size={18} />
              Continue with Google
            </button>
            <div className="auth-or"><span>or</span></div>
          </>
        )}

        {sent ? (
          <div className="auth-sent">
            <p>Check your inbox — we sent a sign-in link to <b>{email.trim()}</b>.</p>
            <button type="button" className="auth-textbtn" onClick={() => { setSent(false); setEmail('') }}>
              Use a different email
            </button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleEmail}>
            <input
              className="auth-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              spellCheck={false}
              required
            />
            <button type="submit" className="auth-emailbtn" disabled={busy || !email.trim()}>
              Email me a sign-in link
            </button>
          </form>
        )}

        {error && <div className="auth-error">{error}</div>}

        <p className="auth-fine">Each account gets its own private board.</p>
      </div>
    </div>
  )
}
