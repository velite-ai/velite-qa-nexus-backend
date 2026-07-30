# Velite QA Nexus — Self-Hosted Backend

Team-friendly QA operations app: **no Google login for anyone but the owner**, data still lands in the owner's Google Drive, new devices need OTP approval from the owner's mobile.

- Owner: `velite@velite.in` (only account that touches Google — once, at setup)
- QA team: opens URL → clicks their name → works. Zero Google interaction, ever.
- New device on new PC → OTP sent to owner's mobile (+91 9815042727 via MSG91) + email backup → owner reads OTP to team member → device approved for life.
- Runs on: **Coolify** on a **Hetzner Cloud** VM (CPX22 sufficient).

---

## Architecture

```
Browser (QA team laptop)
    │ HTTPS
    ▼
[Coolify → Traefik reverse proxy]
    │
    ▼
[Node.js container]
    ├── Serves static frontend from /public
    ├── /api/device/*       ← device approval + OTP
    ├── /api/data/*         ← Drive proxy for JSON data
    ├── /api/files/*        ← Drive proxy for binary uploads/downloads
    ├── /api/admin/*        ← admin panel (approve/revoke devices)
    ├── /setup/*            ← ONE-TIME: generate Google refresh token
    └── SQLite → data/velite.db   (Coolify Persistent Volume)
        │
        ▼ (via stored refresh token, server-side only)
    Google Drive (velite@velite.in)
```

---

## Owner's one-time deployment checklist

You'll do these 5 things once. Total ~20 minutes. After that, forever unmaintained.

### ① Add DNS A record on Wix (5 min)

1. Log in to https://manage.wix.com → **Domains** → your `velite.in` → **DNS Records** (usually under "Advanced" → "Edit DNS")
2. Add a new **A record**:
   - **Host name / Name**: `qa`
   - **Value / Points to**: `46.225.81.186` (your Hetzner server IPv4)
   - **TTL**: `1 hour` (or default)
3. Save. Wait 1-10 minutes for DNS to propagate.
4. Verify: `nslookup qa.velite.in` from a terminal should return `46.225.81.186`

### ② Create Google OAuth Client (5 min — if you don't already have one)

If you already have one from the Vercel version, **reuse it** — skip to Step ③.

1. Open https://console.cloud.google.com/apis/credentials (as `velite@velite.in`)
2. **+ Create Credentials** → **OAuth Client ID**
3. Application type: **Web application**
4. Name: `Velite QA Nexus Backend`
5. **Authorized redirect URIs** → add:
   ```
   https://qa.velite.in/setup/callback
   ```
6. Click **Create**. Copy the **Client ID** and **Client Secret**.

### ③ Create Coolify app (10 min)

In your Coolify dashboard at your existing Coolify install:

1. **+ New Resource** → **Public Repository** (or Private with GitHub token)
2. **Repository URL**: `https://github.com/velite-ai/velite-qa-nexus-backend`
3. **Branch**: `main`
4. **Build Pack**: Dockerfile (Coolify auto-detects the Dockerfile in the repo root)
5. **Port**: `8080`
6. **Domain**: `https://qa.velite.in` — Coolify auto-issues TLS via Let's Encrypt
7. **Persistent Storage** → **+ Add**:
   - **Name**: `velite-data`
   - **Mount Path**: `/app/data`
   - **Size**: 1 GB
8. **Environment Variables** — paste all of these (values below):

```
PORT=8080
NODE_ENV=production
PUBLIC_URL=https://qa.velite.in
SESSION_SECRET=<generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">

GOOGLE_CLIENT_ID=<from Step ②>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<from Step ②>
GOOGLE_REFRESH_TOKEN=  ← leave empty for now; you'll fill after Step ⑤
GOOGLE_SHARED_FOLDER_ID=1cc9gYp2hwzOxLd1_MKzNbXS9ONrFNP6i

MSG91_AUTH_KEY=<your MSG91 Auth Key>
MSG91_SENDER_ID=VELITE           ← or whichever 6-letter ID you registered
MSG91_TEMPLATE_ID=<your DLT template ID>
OWNER_MOBILE=9815042727
OWNER_MOBILE_COUNTRY_CODE=91

OWNER_EMAIL=velite@velite.in
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=velite@velite.in
SMTP_PASSWORD=<Google App Password — see below>
```

**Google App Password** — DO NOT use your real Gmail password. Generate one at:
https://myaccount.google.com/apppasswords → App name: "Velite QA Nexus" → Create → copy the 16-char password → paste into `SMTP_PASSWORD`.

9. Click **Deploy**. Coolify pulls the repo, builds the Docker image, starts it. Watch logs for `listening on :8080`.

### ④ Visit https://qa.velite.in to verify

Once the domain is live and Coolify says "healthy":
- Open https://qa.velite.in in your browser
- You should see the OTP approval screen (because your device isn't approved yet — you're the first!)
- **Skip verifying OTP right now** — proceed to Step ⑤ first.

### ⑤ Generate the Google refresh token (5 min)

The backend can't talk to Drive yet — no refresh token. Fix this once:

1. Open https://qa.velite.in/setup/start in a browser signed into `velite@velite.in`
2. Google shows the standard consent screen ("Velite QA Nexus wants access to: See, edit, create, and delete all your Google Drive files") → click **Allow**
3. You're redirected to `/setup/callback` which displays a **long refresh token** (looks like `1//0gAxxxxxxxxxxx...`)
4. Copy the token
5. Back in Coolify → this app → **Environment Variables** → set `GOOGLE_REFRESH_TOKEN` = <the token you copied> → **Save** → **Redeploy**
6. Wait for Coolify to redeploy (~30s)

### ⑥ Approve your own device (1 min)

Now that the backend has the Drive token, it can actually send SMS. Approve yourself:

1. Refresh https://qa.velite.in
2. The OTP screen re-appears
3. SMS arrives on `+91 9815042727` with the 6-digit code (and email backup at `velite@velite.in`)
4. Enter the code → **Verify & activate**
5. You're in the app — first device approved.

### ⑦ Onboard the team

For each QA team member:

1. Send them the URL: https://qa.velite.in
2. They open it, see the OTP screen
3. SMS arrives on **your** mobile (as owner) — you WhatsApp or read the code to them
4. They enter → approved for life on that device

Total onboarding per person: 30 seconds of your attention.

---

## Ongoing maintenance

**None expected.** But if you ever need to:

- **Revoke a device** (person leaves): open the app as any approved user → the admin panel exposes a revoke button per device.
- **Rotate the Google refresh token**: revisit `/setup/start`, generate a new token, replace the env var in Coolify, redeploy.
- **Rotate MSG91 key**: replace `MSG91_AUTH_KEY` in Coolify env vars, redeploy.
- **Upgrade the app** (I ship a new version): `git pull` inside Coolify → auto-redeploys.

---

## Files in this repo

```
qa-velite-in/
├── Dockerfile           # Coolify-compatible container definition
├── package.json         # Node dependencies
├── .env.example         # Template for env vars (copy to .env for local dev)
├── src/
│   ├── server.js        # Express server, routes
│   ├── db.js            # SQLite schema + queries
│   ├── drive.js         # Google Drive proxy (server-side, uses refresh token)
│   ├── auth.js          # Device approval + OTP generation
│   ├── sms.js           # MSG91 SMS delivery
│   └── mail.js          # Email fallback via Gmail SMTP
└── public/              # Static frontend
    ├── index.html       # Main app HTML
    ├── style.css        # Styles
    ├── app.js           # Main app logic (modified from Vercel version)
    ├── backend-adapter.js  # NEW: reroutes Drive calls + device approval splash
    └── data/mockData.js # Seed users + demo data
```

---

## Local development (optional)

```bash
git clone https://github.com/velite-ai/velite-qa-nexus-backend
cd velite-qa-nexus-backend
npm install
cp .env.example .env
# Edit .env with real values (or leave placeholders — SMS/Drive will fail but UI loads)
npm run dev
open http://localhost:8080
```

---

## Security notes

- **Refresh token** lives in Coolify env vars (encrypted at rest, never exposed to browser). Anyone with server access can read it — same trust boundary as anyone with SSH to the server.
- **MSG91 auth key** is IP-restricted (whitelisted to your Hetzner IP). A leaked key is useless from any other IP.
- **Session cookies** are HttpOnly + Secure + SameSite=Lax. Rotate `SESSION_SECRET` to invalidate all active sessions immediately.
- **SQLite database** contains device fingerprints and audit log — no secrets. Back up `/app/data/velite.db` periodically if you care about the audit history.
- **Once /setup is used**, consider removing or IP-restricting that route in a future update to prevent someone from generating a new refresh token if they gain URL access.

---

Built for a small pharma QA team where every second of friction burns productivity. If it needs to change, PRs welcome.
