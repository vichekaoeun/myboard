// Transactional email for magic links. Uses Resend (https://resend.com) when
// RESEND_API_KEY is set; otherwise returns a soft failure the caller can surface.
// Swap the endpoint here to use Postmark/SendGrid/etc. later.

export async function sendMagicLink(env, email, link) {
  if (!env.RESEND_API_KEY) {
    return { ok: false, error: 'Email sending is not configured' }
  }
  const from = env.EMAIL_FROM || 'SimpleBoard <onboarding@resend.dev>'
  const subject = 'Your sign-in link for SimpleBoard'
  const text = `Tap to sign in to SimpleBoard:\n\n${link}\n\nThis link expires in 15 minutes. If you didn't request it, ignore this email.`
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:460px;margin:0 auto;padding:24px;color:#2a2723">
      <h2 style="margin:0 0 6px">SimpleBoard</h2>
      <p style="margin:0 0 18px;color:#6b6153">Tap the button to sign in. This link expires in 15 minutes.</p>
      <p style="margin:0 0 22px">
        <a href="${link}" style="display:inline-block;padding:11px 18px;background:#e8a33d;color:#3a2a12;border-radius:8px;text-decoration:none;font-weight:700">Open my board</a>
      </p>
      <p style="margin:0;color:#9b9182;font-size:12px">If you didn't request this, you can safely ignore this email.</p>
    </div>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [email], subject, html, text }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { ok: false, error: `Email provider error (${res.status}) ${detail.slice(0, 120)}`.trim() }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: 'Email provider unreachable' }
  }
}
