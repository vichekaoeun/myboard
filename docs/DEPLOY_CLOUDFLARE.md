# Deploying My Board on Cloudflare (Workers + D1 + Durable Objects)

One Worker serves both the static SPA (`./dist`) and the `/api/*` backend:

- **D1** – one JSON board per account (`boards` table), plus `users` / `login_tokens`.
- **Durable Object** (`Room`, one per account) – realtime "board changed" pings over WebSocket.
- **Auth** – signed session cookie; Google OAuth and passwordless email magic links.
- **Static assets** – free and unlimited; only `/api/*` runs the Worker (100k req/day free).

## 1. Local development

```bash
npm install
npm run db:local          # create the D1 tables in the local SQLite copy
npm run worker:dev        # Worker + API on http://localhost:8787
npm run dev               # Vite SPA on http://localhost:5173 (proxies /api)
```

`.dev.vars` (gitignored) holds local secrets — copy `.dev.vars.example`. With
`DEV_RETURN_LINK=true` the magic link is returned in the API response instead of
being emailed, so you can sign in without an email provider.

## 2. First-time Cloudflare setup

```bash
npx wrangler login
npx wrangler d1 create myboard          # copy the printed database_id
```

Paste that id into `wrangler.toml` → `[[d1_databases]] database_id`.

Open the Cloudflare dashboard → **Compute (Workers & Pages)** once. This creates
your `workers.dev` subdomain, which `wrangler deploy` requires. Without it deploy
fails with `code: 10063 — You need a workers.dev subdomain`.

Create the tables in production:

```bash
npm run db:remote
```

Set the production origin in `wrangler.toml` → `[vars] PUBLIC_BASE_URL`
(e.g. `https://myboard.<your-subdomain>.workers.dev` or a custom domain), then
add secrets:

```bash
npx wrangler secret put SESSION_SECRET      # long random string
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put RESEND_API_KEY      # for magic-link emails
```

`EMAIL_FROM` can stay a plain var in `wrangler.toml` (or a secret).

## 3. Google OAuth

Google Cloud Console → APIs & Services → Credentials → **Web application**.
Authorized redirect URIs (add both), where `<PUBLIC_BASE_URL>` is your origin:

- `http://localhost:5173/api/auth/google/callback`
- `<PUBLIC_BASE_URL>/api/auth/google/callback`

Google sign-in only appears on the login screen when `GOOGLE_CLIENT_ID` is set.

## 4. Email (magic links)

Create a [Resend](https://resend.com) API key and verify a sending domain, then
set `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `My Board <login@yourdomain.com>`).
The email form appears on the login screen when email is configured.

## 5. Deploy

```bash
npm run deploy    # vite build && wrangler deploy
```

Attach a custom domain in the Cloudflare dashboard if you want one. Optionally
connect the repo for auto-deploys (Build command: `npm run build`,
Deploy command: `npx wrangler deploy`).

## 6. Custom domain & data

The board lives in D1 (local-first in the browser, mirrored to D1). To move an
existing board across origins, use **Export** on the old site and **Import** on
the new one.

## Notes & limits

- **Free tier:** 100k Worker requests/day, 10 ms CPU/request, D1 5 GB / 5M reads
  per day, Durable Objects 100k requests/day. Plenty for hundreds of users.
- **Board size cap:** `worker/board.js` rejects payloads over ~1.5 MB. Move
  images/audio/video to object storage (R2) rather than inline base64, which is
  also the ceiling you'll hit first as boards grow.
- **No password hashing**, so requests stay well under the 10 ms CPU budget.
