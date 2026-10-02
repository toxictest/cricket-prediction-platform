# 🏏 Cricket Prediction Community Platform

A **production-grade, cyberpunk-themed Next.js 15** web platform where visitors must register
before they can reach the Android application download.

Members sign in with Google, a member record is provisioned in PostgreSQL with an
auto-generated referral code, and the Download Center unlocks — gated by edge middleware *and*
verified again on the server before a single byte of the APK is streamed.

<p align="center">
  <img src="docs/screenshots/01-landing-hero.png" alt="Landing page hero" width="100%">
</p>

---

## Table of Contents

1. [Feature Overview](#1-feature-overview)
2. [Tech Stack](#2-tech-stack)
3. [Requirements](#3-requirements)
4. [Quick Start](#4-quick-start)
5. [Environment Variables](#5-environment-variables)
6. [Google OAuth Setup](#6-google-oauth-setup)
7. [Google-Only Authentication](#7-google-only-authentication)
8. [Database](#8-database)
9. [The APK Artifact](#9-the-apk-artifact)
10. [Project Structure](#10-project-structure)
11. [Routes & API Reference](#11-routes--api-reference)
12. [How the Access Gate Works](#12-how-the-access-gate-works)
13. [Theming & Design System](#13-theming--design-system)
13b. [Testing](#13b-testing)
14. [Deployment](#14-deployment)
15. [Security Notes](#15-security-notes)
16. [Scripts Reference](#16-scripts-reference)
17. [Troubleshooting](#17-troubleshooting)
18. [Verified Behaviours](#18-verified-behaviours)

---

## 1. Feature Overview

| Area | What you get |
|---|---|
| **Landing page** (`/`) | Hero with animated fire-particle canvas, live boot-log terminal, features grid, about + platform topology, 4-step protocol, 8-question FAQ, closing CTA, footer |
| **Login** (`/login`) | Google OAuth, cyber UI, loading states, 15 mapped error codes with human explanations, developer access channel |
| **Register** (`/register`) | Google OAuth, optional referral code with debounced server-side validation, "what gets stored" disclosure |
| **Dashboard** (`/dashboard`) | Profile card, live registration status, auto-generated referral code + share link, account details, membership tier progress, referral network, download shortcut |
| **Download Center** (`/download`) | Members-only APK, real SHA-256 of the bytes on disk, build specs, install guide modal, personal audit log |
| **Access gate** | `"Access Restricted"` / `"Please activate your account first."` with a redirect button to `/register` |
| **Referrals** | Crypto-random collision-free codes, cookie-based attribution that survives the OAuth round-trip, self-referral blocked, tier progression |
| **Effects** | Fire particle canvas, cyber grid, ambient glow orbs, scanlines, film grain, vignette, neon borders, glassmorphism, terminal windows, glitch text |
| **Quality** | TypeScript strict, zero `any` in app code, WCAG-minded semantics, `prefers-reduced-motion` respected throughout, responsive from 320 px up |

### Screenshots

| | |
|---|---|
| ![Features](docs/screenshots/02-landing-features.png) | ![Download Center](docs/screenshots/08-download-center.png) |
| Features grid | Members-only Download Center |
| ![Dashboard](docs/screenshots/10-dashboard.png) | ![Access Restricted](docs/screenshots/06-login-restricted.png) |
| Member dashboard | The access gate |
| ![Mobile](docs/screenshots/12-mobile-landing.png) | ![Register](docs/screenshots/07-register.png) |
| Mobile-first landing | Registration form |

---

## 2. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router, Server Components) | **15.5.27** |
| Language | TypeScript (strict) | 5.9.3 |
| UI runtime | React | **19.3.0** |
| Styling | Tailwind CSS + tailwindcss-animate | 3.4.19 |
| Components | shadcn/ui pattern over Radix primitives | — |
| Animation | Framer Motion | 12.43.0 |
| Icons | Lucide React | 0.545.0 |
| Auth | NextAuth (Google OAuth 2.0, JWT sessions) | 4.24.15 |
| ORM | Prisma | 6.19.3 |
| Database | PostgreSQL | 15+ (verified on 17) |
| Validation | Zod | 3.25.76 |
| Toasts | Sonner | 2.0.8 |
| Fonts | Inter · JetBrains Mono · Orbitron via `next/font` | — |

---

## 3. Requirements

- **Node.js** ≥ 18.18 (20 LTS recommended — verified on 20.20)
- **PostgreSQL** ≥ 14 running locally or reachable over the network
- **npm** ≥ 9
- A **Google Cloud** project with an OAuth 2.0 client — *optional*, see §7
- ~1 GB free disk for `node_modules` and the Next.js build cache

---

## 4. Quick Start

```bash
# 1 — install dependencies (runs `prisma generate` automatically)
npm install

# 2 — create your environment file
cp .env.example .env
#    then edit .env — at minimum set DATABASE_URL and NEXTAUTH_SECRET
#    generate a secret with:  openssl rand -base64 32

# 3 — bootstrap PostgreSQL: install if needed, create role + databases,
#     generate .env with a NEXTAUTH_SECRET, apply migrations, and seed
npm run db:setup

# 4 — generate a placeholder download artifact
npm run apk:placeholder

# 5 — start the dev server
npm run dev
```

> **`npm run db:setup` is the fast path.** It is idempotent and safe to re-run,
> and it handles a machine with no PostgreSQL at all. If you already have a
> database you want to point at, skip it and set `DATABASE_URL` in `.env`
> yourself, then run `npm run db:deploy` and optionally `npm run db:seed`.
>
> Use `npm run db:setup:reset` to drop and rebuild from scratch.

Open <http://localhost:3000>.

**Verify the install:**

```bash
curl http://localhost:3000/api/health
# {"ok":true,"data":{"status":"healthy","database":"connected",...}}
```

Full production check:

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # next lint
npm run build        # prisma generate && next build
npm start            # serves the optimised build
```

---

## 5. Environment Variables

Every variable lives in `.env` (loaded by **both** the Prisma CLI and Next.js).
Never commit it — only `.env.example` is tracked.

### Required

| Variable | Purpose | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db?schema=public` |
| `NEXTAUTH_SECRET` | Signs + encrypts JWTs. **Rotating this logs everyone out.** | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Canonical origin. Must match the OAuth redirect exactly. | `http://localhost:3000` |

### Strongly recommended

| Variable | Purpose | Default |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Origin used to build referral links | falls back to `NEXTAUTH_URL` |
| `SHADOW_DATABASE_URL` | Required by `prisma migrate dev` only | — |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Enable Google sign-in | empty → UI warns |
| `NEXT_PUBLIC_APK_DOWNLOAD_URL` | Serve the APK from a CDN instead | empty → use `/api/download` |

### Optional

| Variable | Purpose | Default |
|---|---|---|
| `APK_FILE_NAME` | Filename served by `/api/download` | `app-release.apk` |
| `APK_VERSION` | Version shown across the UI | `1.0.0` |
| `REFERRAL_CODE_LENGTH` | Random body length (4–16) | `8` |
| `REFERRAL_CODE_PREFIX` | Code prefix (≤ 6 chars) | `CRC` |

> **Note:** authentication is Google-only. `GOOGLE_CLIENT_ID` and
> `GOOGLE_CLIENT_SECRET` are the only required credentials, and without them
> no account can be created or accessed.

---

## 6. Google OAuth Setup

1. Open the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Create (or select) a project → **APIs & Services** → **OAuth consent screen**.
   - User type: **External**
   - Publish the app, or add test users while it is in *Testing*.
3. **Credentials** → **Create credentials** → **OAuth client ID** → **Web application**.
4. Add the **Authorised JavaScript origins**:

   ```
   http://localhost:3000
   https://your-domain.com
   ```

5. Add the **Authorised redirect URIs** — these must match character for character:

   ```
   http://localhost:3000/api/auth/callback/google
   https://your-domain.com/api/auth/callback/google
   ```

6. Copy the values into `.env`:

   ```env
   GOOGLE_CLIENT_ID="1234567890-abcdefg.apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="GOCSPX-xxxxxxxxxxxxxxxxxxxx"
   ```

7. Restart the dev server.

### Common OAuth failures

| Symptom | Cause |
|---|---|
| `redirect_uri_mismatch` | The URI is not registered, or `NEXTAUTH_URL` disagrees with the browser origin. |
| `OAuthCallback` error page | Same as above — the error detail on `/login` names this explicitly. |
| `Access blocked: app not verified` | Add your Google account under *Test users*, or publish the consent screen. |
| Sign-in succeeds, then bounces back to `/login` | `NEXTAUTH_URL` protocol mismatch (see [§17](#17-troubleshooting)). |

---

## 7. Google-Only Authentication

**Google is the only sign-in method.** There is no email/password fallback and
no developer bypass channel — that scaffolding was removed deliberately, so
every row in `users` corresponds to a real, verified Google identity.

Two consequences are worth stating plainly:

- With `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` unset, **nobody can sign in
  or register.** `/login` and `/register` render an explicit *"No sign-in
  method is configured"* panel rather than a button that fails at the end.
- `/api/auth/providers` returns exactly one entry. There is no credentials
  provider registered, so there is nothing to brute-force or bypass.

Configure credentials once, following §6 locally or `DEPLOY.md` for a hosted
deployment.

### The SSO fire handshake

Signing in with Google means leaving the site, so the effect is split across
the round-trip. The two halves are joined by a one-shot `sessionStorage` flag.

**Outbound — `SsoFireOverlay`** (`src/components/effects/sso-fire-overlay.tsx`)
renders the instant the Google button is pressed:

| Layer | What it is |
|---|---|
| Backdrop | `#09090b` at 94 % opacity + `backdrop-blur-xl` |
| Fire | `FireParticleCanvas` at density 300, intensity 2 |
| Cyber grid | dual CSS gradients, radially masked to the centre |
| Floor flare | bottom radial gradient + three expanding shockwave rings |
| Handshake card | glass panel showing a terminal → Google node link, a beam with four travelling packets, a six-line transit log and a determinate progress bar |

The log advances one line every 300 ms, and the browser is held for
`SSO_STEPS.length × 300 + 260 ≈ 2.06 s` before `signIn("google")` fires. The
delay is deliberate: it converts a hard jump into a visible state change.

**Inbound — `AuthWelcomeBurst`**
(`src/components/effects/auth-welcome-burst.tsx`) is mounted in
`src/app/dashboard/page.tsx`. On mount it reads `cpc:sso:transit` from
`sessionStorage`, removes it synchronously, and — only if it was present —
plays a 2.6 s fire burst with an **ACCESS GRANTED** badge.

`sessionStorage` is the correct store here: it is tab-scoped, it survives the
same-tab redirect to Google and back, and it is discarded when the tab closes,
so a returning visitor never sees a stale celebration. Because the key is
deleted on read, reloading the dashboard does not replay it.

Both halves fail safely. The overlay locks body scroll and restores it
unconditionally on unmount; a 12 s watchdog un-freezes the form if the redirect
never fires; and a failed or cancelled handshake clears the flag so no spurious
burst appears later.

---

## 8. Database

### Schema

`prisma/schema.prisma` defines two models. TypeScript stays idiomatic
(PascalCase) while PostgreSQL stays idiomatic (`snake_case`) via `@map`.

```
users
├── id             TEXT          PK (cuid)
├── google_id      TEXT          UNIQUE NOT NULL      -- Google "sub" claim
├── name           VARCHAR(120)  NOT NULL
├── email          VARCHAR(254)  UNIQUE NOT NULL      -- lower-cased
├── image          TEXT                               -- Google CDN URL
├── referral_code  VARCHAR(32)   UNIQUE NOT NULL      -- e.g. "CRC-7K2M9QX4"
├── referred_by_id TEXT          FK → users.id (SET NULL)
├── last_login_at  TIMESTAMPTZ
├── created_at     TIMESTAMPTZ   DEFAULT now()
└── updated_at     TIMESTAMPTZ   @updatedAt

download_logs
├── id          TEXT         PK (cuid)
├── user_id     TEXT         FK → users.id (CASCADE)
├── version     VARCHAR(24)  DEFAULT '1.0.0'
├── platform    VARCHAR(24)  DEFAULT 'android'
├── ip_hash     VARCHAR(64)       -- sha256(secret + ip), never the raw IP
├── user_agent  VARCHAR(300)
└── created_at  TIMESTAMPTZ  DEFAULT now()
```

Indexes: `users(email)`, `users(created_at)`, `users(referred_by_id)`,
`download_logs(user_id, created_at)`, `download_logs(created_at)`.

### Commands

```bash
npm run db:generate    # regenerate the typed client
npm run db:push        # sync schema without a migration (prototyping)
npm run db:migrate     # create + apply a migration (development)
npm run db:deploy      # apply pending migrations (CI / production)
npm run db:studio      # browse data in Prisma Studio
npm run db:seed        # load the demo member network
npm run db:reset       # drop, re-migrate and re-seed
```

### Referral code generation

`src/lib/referral.ts` allocates codes from a **32-character alphabet** that
excludes the visually ambiguous `O/0`, `I/1/L` and `U`, so a code survives being
read aloud or transcribed from a screenshot.

Three layers guarantee uniqueness:

1. **Unbiased sampling.** The alphabet is **30 characters**, not a power of two,
   so `256 % 30 === 16` — a naive `randomBytes()[i] % 30` would make the first
   16 characters ~8.5% more likely and measurably shrink the keyspace. Codes are
   drawn with `crypto.randomInt`, which **rejection-samples** internally and is
   therefore exactly uniform. `tests/referral.test.ts` asserts both the hazard
   and the fix.
2. A `findUnique` pre-check.
3. The authoritative `@unique` constraint, with `provisionUser()` retrying on
   `P2002` with a freshly generated code.

The keyspace is `30⁸ = 656,100,000,000` combinations.

---

## 9. The APK Artifact

The Download Center resolves its artifact in this order:

| # | Location | Notes |
|---|---|---|
| 1 | `storage/apk/app-release.apk` | Private staging dir — **not** web-served. Preferred. |
| 2 | `public/downloads/app-release.apk` | Tracked mirror, web-served at `/downloads/…` |
| 3 | `NEXT_PUBLIC_APK_DOWNLOAD_URL` | External CDN / object storage |

### Demo placeholder

```bash
npm run apk:placeholder
```

Writes a valid, uncompressed **ZIP** archive (an `.apk` *is* a ZIP) containing
`README.txt`, `BUILD_INFO.json` and `NOT_AN_INSTALLABLE_BUILD.txt`. It is **not
installable on Android** — it exists purely so the gate, the audit log, the
streaming route and the browser save dialog can be exercised. The Download
Center detects it (anything under 64 KB) and shows an explicit
"Demo artifact detected" warning.

### Shipping a real build

```bash
./gradlew assembleRelease

cp app/build/outputs/apk/release/app-release.apk \
   public/downloads/app-release.apk
# or keep binaries out of version control:
mkdir -p storage/apk && cp app-release.apk storage/apk/
```

The SHA-256 displayed in the UI is **computed from the bytes on disk** at
request time (`src/lib/artifact.ts`), so the published checksum always matches
the file the member receives. Drop in a new build and the page updates itself.

The response is served with:

```
Content-Type: application/vnd.android.package-archive
Content-Disposition: attachment; filename="app-release.apk"
Cache-Control: no-store, no-cache, must-revalidate, max-age=0
X-App-Version: 1.0.0
```

and streamed via `Readable.toWeb()` — an 18 MB file is never buffered into the
serverless function's memory.

---

## 10. Project Structure

```
cricket-prediction-platform/
├── prisma/
│   ├── migrations/20261002122519_init/migration.sql
│   ├── schema.prisma                   # User + DownloadLog
│   └── seed.ts                         # demo member network
│
├── public/
│   └── downloads/app-release.apk       # demo artifact (replace with real build)
│
├── scripts/
│   └── make-placeholder-apk.mjs        # zero-dependency ZIP writer
│
├── docs/screenshots/                   # captured from the running app
│
├── src/
│   ├── middleware.ts                   # edge gate + referral capture
│   │
│   ├── app/
│   │   ├── layout.tsx                  # fonts, metadata, background, providers
│   │   ├── page.tsx                    # landing (Server Component)
│   │   ├── globals.css                 # cyberpunk design system
│   │   ├── loading.tsx                 # terminal-style route fallback
│   │   ├── error.tsx                   # route error boundary
│   │   ├── global-error.tsx            # root boundary (own <html>)
│   │   ├── not-found.tsx               # 404
│   │   ├── icon.svg                    # app icon
│   │   ├── manifest.webmanifest
│   │   ├── robots.ts  /  sitemap.ts
│   │   │
│   │   ├── login/page.tsx              # RSC shell + Suspense island
│   │   ├── register/page.tsx           # RSC shell + Suspense island
│   │   ├── dashboard/page.tsx          # authenticated, reads Postgres
│   │   ├── download/page.tsx           # authenticated + gated
│   │   │
│   │   ├── (legal)/                    # route group — no URL segment
│   │   │   ├── layout.tsx
│   │   │   ├── terms/page.tsx
│   │   │   ├── privacy/page.tsx
│   │   │   ├── responsible-play/page.tsx
│   │   │   └── contact/page.tsx
│   │   │
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts
│   │       ├── health/route.ts
│   │       ├── session/route.ts
│   │       ├── download/route.ts        # ★ the real gate
│   │       ├── referral/route.ts        # public validation
│   │       └── referral/capture/route.ts# writes the attribution cookie
│   │
│   ├── components/
│   │   ├── providers.tsx                # SessionProvider + Tooltip + Toaster
│   │   ├── ui/                          # shadcn primitives
│   │   │   ├── accordion.tsx  avatar.tsx  badge.tsx  button.tsx
│   │   │   ├── card.tsx       dialog.tsx  input.tsx  label.tsx
│   │   │   ├── progress.tsx   separator.tsx  skeleton.tsx
│   │   │   ├── sonner.tsx     tooltip.tsx
│   │   ├── layout/     navbar.tsx  footer.tsx
│   │   ├── sections/   hero.tsx  features.tsx  about.tsx
│   │   │               how-it-works.tsx  faq.tsx  final-cta.tsx
│   │   ├── auth/       auth-shell.tsx  login-form.tsx
│   │   │               register-form.tsx  access-notice.tsx
│   │   ├── dashboard/  referral-panel.tsx
│   │   ├── download/   access-restricted.tsx  download-button.tsx
│   │   │               install-guide.tsx
│   │   ├── effects/    fire-particle-canvas.tsx  cyber-background.tsx
│   │   │               terminal-window.tsx  reveal.tsx  section-heading.tsx
│   │   └── shared/     copy-button.tsx  legal-article.tsx
│   │
│   ├── lib/
│   │   ├── auth.ts          # NextAuth options + providers + callbacks
│   │   ├── prisma.ts        # singleton client (HMR-safe)
│   │   ├── user.ts          # provisioning, overview queries, audit writes
│   │   ├── referral.ts      # code generation + resolution
│   │   ├── artifact.ts      # APK discovery + SHA-256
│   │   ├── constants.ts     # nav, features, FAQ, app metadata, tiers
│   │   └── utils.ts         # cn, date formatting, absoluteUrl
│   │
│   └── types/
│       ├── index.ts         # shared domain + API envelope types
│       └── next-auth.d.ts   # Session/JWT module augmentation
│
├── .env.example   .env   .gitignore   .eslintrc.json
├── components.json            # shadcn CLI config
├── next.config.ts             # security headers, image domains
├── postcss.config.mjs
├── tailwind.config.ts         # design tokens, keyframes, neon shadows
├── tsconfig.json              # strict, "@/*" path alias
└── package.json
```

---

## 11. Routes & API Reference

### Pages

| Route | Access | Renders |
|---|---|---|
| `/` | Public | Landing page (hero → features → about → how it works → FAQ → CTA → footer) |
| `/login` | Public (auth users redirected to `/dashboard`) | Google + developer sign-in, error banner, access notice |
| `/register` | Public (auth users redirected to `/dashboard`) | Referral field, Google + developer registration |
| `/dashboard` | 🔒 Member | Profile, referral code, tier, network, download shortcut |
| `/download` | 🔒 Member | APK, checksum, specs, install guide, audit log |
| `/terms` `/privacy` `/responsible-play` `/contact` | Public | Policy documents |

### API

| Method | Route | Auth | Behaviour |
|---|---|---|---|
| `GET/POST` | `/api/auth/[...nextauth]` | — | NextAuth handler (Node runtime — Prisma needs it) |
| `GET` | `/api/health` | Public | Liveness + `SELECT 1`. `200` healthy, `503` degraded |
| `GET` | `/api/session` | 🔒 | Canonical "who am I" with live referral + download counts |
| `GET` | `/api/download` | 🔒 | Streams the APK, writes the audit row, `401` for guests |
| `POST` | `/api/download` | — | `405 Method Not Allowed` |
| `GET` | `/api/referral?code=` | Public (rate-limited 30/min/IP) | Validates a code, reveals **only** the referrer's first name |
| `POST` | `/api/referral/capture` | Public | Validates then stores `cpc_ref` as an httpOnly cookie |
| `DELETE` | `/api/referral/capture` | Public | Clears the referral cookie |

All routes return the same envelope:

```jsonc
{ "ok": true,  "data": { /* … */ } }
{ "ok": false, "error": "Human readable", "code": "UNAUTHORIZED" }
```

Error codes: `UNAUTHORIZED` · `FORBIDDEN` · `NOT_FOUND` ·
`VALIDATION_ERROR` · `RATE_LIMITED` · `INTERNAL_ERROR`

---

## 12. How the Access Gate Works

The gate is enforced in **three independent layers**. Hiding a button would not
be enough — the check is repeated on the server before any bytes are sent.

### Layer 1 — Edge middleware (`src/middleware.ts`)

```ts
const PROTECTED_PREFIXES = ["/dashboard", "/download", "/downloads"];
```

The exported middleware is **composed**, not a bare `withAuth` call, because
`next-auth@4`'s `handleMiddleware` returns early — without ever invoking your
callback — for any path equal to `pages.signIn` or `pages.error`:

```js
// node_modules/next-auth/next/middleware.js
if (`${basePath}${pathname}`.startsWith(authPath) ||
    [signInPage, errorPage].includes(pathname) ||
    publicPaths.some(p => pathname.startsWith(p))) {
  return;   // ← your callback never runs
}
```

That is fine for a plain gate, but it makes it impossible to bounce an
already-authenticated member away from `/login`. So the composed middleware
runs first and handles everything the gate cannot see:

1. **Infrastructure bypass** — `/api/auth/*`, `/api/health`, `/_next/*`,
   `favicon`, `robots.txt`, `sitemap.xml`, manifest, icon routes.
2. **Referral capture** — `?ref=CRC-XXXX` (or `?referral=`) is pattern-validated
   and written to an httpOnly `cpc_ref` cookie (30 days), so the invite survives
   the OAuth round-trip. `callbacks.signIn` consumes it, then deletes it.
3. **Auth-page bounce** — a signed-in member hitting `/login` or `/register` is
   redirected to `callbackUrl` (same-origin relative paths only) or `/dashboard`.
4. **Delegation** to `withAuth`, whose `authorized` callback is the single
   source of truth for protected routes.

The matcher excludes anything with a file extension, so middleware never runs
for CSS, JS chunks, fonts or images.

### Layer 2 — Server-side route check

`/api/download` calls `getServerSession(authOptions)` and resolves
`session.user.id` against PostgreSQL **before** streaming:

```json
HTTP/1.1 401 Unauthorized
{ "ok": false, "error": "Access restricted. Please activate your account first.",
  "code": "UNAUTHORIZED" }
```

Every authorised download writes a `download_logs` row with the build version,
platform, user agent and a **one-way hash** of the IP.

### Layer 3 — The rendered page

`/download` and `/dashboard` are Server Components. If the session is missing or
the database row has been deleted, they render `<AccessRestricted />`:

> ### Access Restricted
> Please activate your account first.
>
> `$ curl -I /api/download`
> `HTTP/1.1 401 Unauthorized`
>
> **[ Activate Account ]** **[ Sign In ]**

When the middleware intercepts first, the same copy appears as a banner on
`/login`, naming the blocked route (`gated route: /download · Download Center`).

### Referral attribution flow

```
Visitor opens  /register?ref=CRC-ARCH1TEC
      │
      ├─ middleware validates the pattern → sets httpOnly cookie  cpc_ref=CRC-ARCH1TEC (30d)
      │
      ├─ form debounces → GET /api/referral?code=CRC-ARCH1TEC
      │        → "Priya will be credited"  (first name only)
      │
      ├─ POST /api/referral/capture → re-validated, cookie refreshed
      │
      ├─ Google OAuth round-trip (full page navigation)
      │
      └─ NextAuth signIn callback reads cpc_ref
              → provisionUser() creates the row with referred_by_id
              → cookie deleted
```

Self-referral is rejected by comparing the resolved referrer's email against the
signing-in email.

---

## 13. Theming & Design System

### Palette

| Token | Value | Use |
|---|---|---|
| `cyber.void` | `#09090b` | Page background |
| `cyber.abyss` | `#050507` | Deepest layer |
| `cyber.panel` | `#0d0d11` | Raised surfaces |
| `cyber.neon` / `primary` | `#ef4444` | Accent, borders, glow |
| `cyber.ember` | `#b91c1c` | Gradient depth |
| `cyber.flare` | `#fb7185` | Highlight text |
| `cyber.plasma` | `#f97316` | Flame mid-tone |
| `cyber.cyan` / `lime` / `amber` | — | Secondary accents |

### Effects

| Effect | Implementation |
|---|---|
| **Fire particles** | `FireParticleCanvas` — one `<canvas>`, additive `mix-blend-screen`, 6-stop colour ramp, radial-gradient sprites, in-place recycling (no per-frame allocation), DPR capped at 2, RAF paused when the tab is hidden, static frame under `prefers-reduced-motion` |
| **Cyber grid** | Two layered CSS gradients at 64 px and 16 px, `mask-image` radial falloff, 24 s background-position drift |
| **Glassmorphism** | `.glass` / `.glass-strong` — gradient fill, `backdrop-filter: blur() saturate()`, hairline border, inset highlight |
| **Neon glow** | `shadow-neon` through `shadow-neon-lg`, `.neon-border-hover` lift + glow on hover |
| **Corner brackets** | `.corner-brackets` — pseudo-elements that expand on hover |
| **Terminal** | `TerminalWindow` types lines with a blinking caret; `role="log"` + `aria-live="polite"` |
| **Scanlines / grain** | Repeating linear gradient + inline SVG `feTurbulence` data URI (no network request) |
| **Glitch** | RGB-split `GlitchText` with a flicker keyframe |
| **SSO fire handshake** | `SsoFireOverlay` + `AuthWelcomeBurst` — a fire particle field at 2× intensity under a glass handshake card, beam packets, a stepped transit log and shockwave rings. Bridges the Google round-trip via a one-shot `sessionStorage` flag |

### Typography

- **Display** — Orbitron 600–900, used for headings (`font-display`)
- **Body** — Inter (`font-sans`)
- **Terminal / mono** — JetBrains Mono (`font-mono`)

All three are self-hosted by `next/font` at build time: no third-party request,
no layout shift, no FOUT.

### Accessibility

- Skip-to-content link
- `:focus-visible` rings on every interactive element
- `aria-hidden` on all decorative layers (background, glitch clones, icons)
- `role="alert"` on error surfaces, `aria-live` on the referral field
- `aria-busy` on loading buttons; the label is preserved so width never shifts
- Colour is never the sole carrier of meaning
- Every animation collapses under `prefers-reduced-motion: reduce`

---

## 13b. Testing

100 tests across two tiers. The integration tiers **skip themselves** when their
dependency is missing, so `npm test` is green on a fresh clone.

```bash
npm run test:unit          # pure logic — no DB, no server. ~0.6 s
npm run test:run           # everything (integration auto-skips if unavailable)
npm run verify             # typecheck + lint + tests + build
```

| File | Tests | Tier |
|---|---|---|
| `tests/referral.test.ts` | 15 | unit |
| `tests/utils.test.ts` | 22 | unit |
| `tests/artifact.test.ts` | 6 | unit |
| `tests/provisioning.test.ts` | 24 | PostgreSQL |
| `tests/http-contract.test.ts` | 33 | running server |

The DB tier needs a database (`npm run db:setup`) and the HTTP tier needs a live
server (`npm run dev` or `npm start`). Point the latter somewhere else with
`TEST_BASE_URL=https://staging.example.com npm run test:integration`.

### What the tests actually pin down

- **Referral crypto is unbiased.** A 60 000-draw frequency check asserts every
  bucket lands within ±15% of the mean — and specifically that the first 16
  characters carry no advantage. This is the test that caught the original
  `% 30` bug.
- **The gate holds from the outside.** Guests get `307` on `/dashboard`,
  `/download` *and* the static `/downloads/*.apk` mirror, `401` from
  `/api/download`, `405` on `POST`, and the 401 body is asserted to contain no
  ZIP magic bytes and no 64-hex substring, so nothing leaks.
- **Self-referral is blocked**, a late arrival can still be attributed, and all
  three unique constraints (`google_id`, `email`, `referral_code`) genuinely
  reject `P2002`.
- **Deletion semantics.** Removing a member cascades their download logs but
  only *detaches* (`SET NULL`) the members they referred.
- **Rate limiting keys per client.** 34 sequential requests from one IP are
  throttled past 30 while a different IP is still served — so the limiter can
  never be bypassed by header rotation *and* can never lock out an unrelated
  client.

### Fixture isolation

The integration suites namespace every row with an `it<timestamp>_` prefix and
delete it in `afterAll`, so they can run repeatedly against a database that also
holds seed data and manual test accounts. `describe.skipIf` flags are resolved
with a **top-level `await`** rather than a `beforeAll` — skip conditions are
evaluated at collection time, so a flag set inside a hook always reads as
`false` and silently skips the whole file.

---

## 14. Deployment

> **Deploying to a free public URL?** See **[DEPLOY.md](DEPLOY.md)** — a
> step-by-step guide for Vercel Hobby + Neon Postgres, including every
> environment variable, the Google OAuth redirect setup, and a
> post-deploy smoke test.

### Vercel (recommended)

1. Push the repository to GitHub and import it in Vercel.
2. Add a Postgres instance — [Neon](https://neon.tech), [Supabase](https://supabase.com)
   or Vercel Postgres all work. Use the **pooled** connection string for
   `DATABASE_URL`.
3. Set the environment variables:

   ```
   DATABASE_URL            postgresql://…?sslmode=require
   NEXTAUTH_SECRET         <openssl rand -base64 32>
   NEXTAUTH_URL            https://your-domain.com
   NEXT_PUBLIC_SITE_URL    https://your-domain.com
   GOOGLE_CLIENT_ID        …
   GOOGLE_CLIENT_SECRET    …
   ```

   Do **not** set `SHADOW_DATABASE_URL` — it is only for local `migrate dev`.

4. Add the production redirect URI in Google Cloud:
   `https://your-domain.com/api/auth/callback/google`
5. Apply migrations. Either add `prisma migrate deploy` to the build command:

   ```jsonc
   "build": "prisma migrate deploy && prisma generate && next build"
   ```

   or run it as a one-off: `npx prisma migrate deploy`.
6. Deploy.

> **HTTPS and cookie names.** NextAuth derives the session cookie name from the
> protocol of `NEXTAUTH_URL`. An `https://` value produces
> `__Secure-next-auth.session-token`; `http://` produces
> `next-auth.session-token`. `next-auth/middleware` makes the same deduction
> internally — so **never hard-code `useSecureCookies`**, or the edge and the
> server will disagree about the cookie name and every gated route will loop to
> `/login`. `src/lib/auth.ts` documents this in place.

### Docker

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json prisma ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./
EXPOSE 3000
CMD ["npm", "start"]
```

### Post-deploy checklist

- [ ] `curl https://your-domain.com/api/health` → `"status":"healthy"`
- [ ] Sign in with Google and confirm a row appears in `users`
- [ ] Confirm `?ref=YOUR-CODE` on `/register` sets `cpc_ref` and attributes the new member
- [ ] Confirm a logged-out request to `/download` returns `307` to `/login`
- [ ] Confirm `curl /api/download` without a cookie returns `401`
- [ ] Replace the demo APK with a signed release build
- [ ] Verify the redirect URI in Google Cloud matches production exactly
- [ ] Confirm `/api/auth/providers` returns `google` and nothing else

---

## 15. Security Notes

| Control | Implementation |
|---|---|
| **No passwords** | Authentication is delegated entirely to Google. There is no password column anywhere in the schema. |
| **Open-redirect protection** | NextAuth's `redirect` callback only accepts same-origin paths, and the login form re-validates `callbackUrl` before honouring it. |
| **Server-side gating** | The gate lives in middleware *and* in the route handler — never only in the UI. |
| **IP privacy** | `download_logs.ip_hash` stores `sha256(secret + ip)[0:40]`. The raw address is never persisted. |
| **No enumeration** | `/api/referral` is rate-limited to 30 req/min/IP and returns only the referrer's first name. |
| **Self-referral blocked** | The resolved referrer's email is compared to the signing-in email. |
| **Security headers** | `X-Frame-Options`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, HSTS, and a `Permissions-Policy` that disables camera/mic/geolocation. |
| **CSP-friendly images** | `next.config.ts` allow-lists only `lh3.googleusercontent.com`. |
| **CSRF** | Handled by NextAuth for the auth flow; `POST` bodies are Zod-validated. |
| **Cascading deletes** | Deleting a member removes every associated download log (`onDelete: Cascade`). Referral links detach (`SET NULL`) rather than deleting the referred member. |
| **Robots** | `/dashboard`, `/download`, `/downloads/` and `/api/` are disallowed for crawlers; `GPTBot` and `CCBot` are blocked outright. |

### Hardening for real traffic

- Swap the in-memory rate limiter in `/api/referral` for Redis
  (`@upstash/ratelimit`) — the interface is identical.
- Add a Content-Security-Policy header in `next.config.ts` once you have
  audited your own inline styles.
- Consider a WAF or Cloudflare in front of `/api/download`.

---

## 16. Scripts Reference

| Script | Command | Purpose |
|---|---|---|
| `npm run dev` | `next dev` | Dev server with HMR |
| `npm run build` | `prisma generate && next build` | Production build |
| `npm start` | `next start` | Serve the production build |
| `npm run lint` | `next lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` | Type check without emitting |
| `npm run db:generate` | `prisma generate` | Regenerate the client |
| `npm run db:push` | `prisma db push` | Sync schema, no migration |
| `npm run db:migrate` | `prisma migrate dev` | Create + apply a migration |
| `npm run db:deploy` | `prisma migrate deploy` | Apply migrations (CI/prod) |
| `npm run db:studio` | `prisma studio` | Data GUI |
| `npm run db:seed` | `tsx prisma/seed.ts` | Demo member network |
| `npm run db:reset` | `prisma migrate reset --force` | Drop, migrate, re-seed |
| `npm run apk:placeholder` | `node scripts/make-placeholder-apk.mjs` | Generate the demo artifact |

---

## 17. Troubleshooting

<details>
<summary><b>Every gated route redirects to /login in a loop</b></summary>

The server and the middleware disagree about the session cookie name. NextAuth
derives it from the protocol of `NEXTAUTH_URL` — `https://` yields
`__Secure-next-auth.session-token`, `http://` yields
`next-auth.session-token`. Fix the mismatch rather than working around it:

```env
NEXTAUTH_URL="http://localhost:3000"   # must match the protocol you actually browse
```

Never hard-code `useSecureCookies` in `authOptions` — `next-auth/middleware`
cannot see that option and will keep looking for the other name.
</details>

<details>
<summary><b>Prisma: "Environment variable not found: DATABASE_URL"</b></summary>

The Prisma CLI reads `.env`, **not** `.env.local`. Keep `DATABASE_URL` in `.env`
(or pass it inline: `DATABASE_URL=… npx prisma db push`).
</details>

<details>
<summary><b>Google: "redirect_uri_mismatch"</b></summary>

The redirect URI must be exact — scheme, host, port and path:

```
http://localhost:3000/api/auth/callback/google
```

Trailing slashes or a `www.` prefix will break it. Changes can take a few
minutes to propagate.
</details>

<details>
<summary><b>"Access Restricted" appears even though I am signed in</b></summary>

Your JWT is valid but the database row is gone (a reseed dropped it). Sign out
and back in to re-provision. Confirm with:

```bash
curl -b "next-auth.session-token=<value>" http://localhost:3000/api/session
```
</details>

<details>
<summary><b>Download returns 404 "Android build is not staged"</b></summary>

Run `npm run apk:placeholder`, or place a real build in `storage/apk/` or
`public/downloads/`.
</details>

<details>
<summary><b>Signed-in members still see the login page instead of being redirected</b></summary>

If you wrap your callback directly in `withAuth`, it will never run for
`pages.signIn` / `pages.error` — `next-auth@4` returns early on those paths
before invoking your callback. Handle the auth-page bounce *outside* the gate:

```ts
const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
if (isAuthRoute(pathname) && token) {
  return NextResponse.redirect(new URL("/dashboard", req.url));
}
return authGate(req, event);
```

See `src/middleware.ts`, which does exactly this.
</details>

<details>
<summary><b>Styles look unstyled / fonts missing</b></summary>

Delete the build cache and rebuild:

```bash
rm -rf .next node_modules/.cache && npm run build
```
</details>

<details>
<summary><b>Fire particles hurt performance on an old phone</b></summary>

Lower the budget at the call site:

```tsx
<CyberBackground density={80} />   {/* default 190 */}
```

The canvas also scales density down automatically below 1440 px and stops
rendering entirely when the tab is hidden.
</details>

---

## 18. Verified Behaviours

Everything below was executed against the running application on **02 Oct 2026**
with PostgreSQL 17.11 and the production build (`npm run build && npm start`).

### `npm run build` — clean

```
✓ Compiled successfully
✓ Generating static pages (12/12)
ƒ Middleware                             63.5 kB
First Load JS shared by all               103 kB
```

`npm run typecheck` (`tsc --noEmit`, strict) reports **zero errors**.

### Automated test suite — 100 / 100 pass

`npx vitest run` against the production build with PostgreSQL 17.11 live:

```
 Test Files  5 passed (5)
      Tests  100 passed (100)
   Duration  1.48s
```

| File | Tests | Tier | What it pins down |
|---|---:|---|---|
| `tests/referral.test.ts` | 15 | pure | Alphabet shape, `CRC-XXXXXXXX` format, 60 000-draw uniformity (no modulo bias), normalisation, collision retry, `tierForReferrals` boundaries |
| `tests/utils.test.ts` | 22 | pure | `cn`, `formatDate`, `timeAgo`, `absoluteUrl` (bare-call trailing-slash regression), `truncateAddress`, IP hashing, `safeCallbackUrl` open-redirect blocking |
| `tests/artifact.test.ts` | 6 | pure | Staged APK exists, size + SHA-256 match `artifact.ts`, ZIP `PK\x03\x04` magic, `Content-Disposition` filename, no secret leakage in the metadata helper |
| `tests/provisioning.test.ts` | 24 | Postgres | `provisionUser` insert, `googleId`/`email` uniqueness (P2002), referral-code generation + collision retry, `referred_by_id` attribution, cookie consumption, self-referral rejection, `download_logs` writes |
| `tests/http-contract.test.ts` | 33 | live HTTP | Every row of the HTTP contract table below, plus security headers, CSRF issuance, provider-list redaction and per-client rate limiting |

Two tiers are deliberate: `npm run test:unit` needs neither a database nor a
server, so it runs in CI before provisioning; `npm run test:integration` needs
both and is what the table below is generated from. `npm run verify` chains
`typecheck && lint && test:run && build`.

### HTTP contract — 36 / 36 assertions pass

| # | Check | Expected | Result |
|---|---|---|---|
| 1 | `GET /` | `200` | ✅ |
| 2 | `GET /login` | `200` | ✅ |
| 3 | `GET /register` | `200` | ✅ |
| 4 | `GET /terms` `/privacy` `/responsible-play` `/contact` | `200` | ✅ |
| 5 | `GET /robots.txt` `/sitemap.xml` `/manifest.webmanifest` `/icon.svg` | `200` | ✅ |
| 6 | `GET /nope` | `404` | ✅ |
| 7 | `GET /api/health` → `"ok": true, "database": "connected"` | `200` | ✅ |
| 8 | `GET /api/referral?code=CRC-ARCH1TEC` → first name only | `200` | ✅ |
| 9 | `GET /api/referral?code=CRC-ZZZZZZZZ` | `404` | ✅ |
| 10 | `GET /api/referral?code=AB` (malformed) | `400` | ✅ |
| 11 | **Guest** `GET /dashboard` | `307 → /login?callbackUrl=%2Fdashboard` | ✅ |
| 12 | **Guest** `GET /download` | `307 → /login?callbackUrl=%2Fdownload` | ✅ |
| 13 | **Guest** `GET /downloads/app-release.apk` | `307` (static mirror gated too) | ✅ |
| 14 | **Guest** `GET /api/download` | `401 UNAUTHORIZED` | ✅ |
| 15 | **Guest** `GET /api/session` | `401 UNAUTHORIZED` | ✅ |
| 16 | `POST /api/download` | `405 Allow: GET` | ✅ |
| 17 | **Member** `GET /dashboard` | `200` | ✅ |
| 18 | **Member** `GET /download` | `200` | ✅ |
| 19 | **Member** `GET /api/download` | `200` | ✅ |
| 20 | …with `Content-Type: application/vnd.android.package-archive` | ✅ | ✅ |
| 21 | …with `Cache-Control: no-store` + `Content-Disposition: attachment` | ✅ | ✅ |
| 22 | **Member** `GET /login` | `307 → /dashboard` | ✅ |
| 23 | **Member** `GET /login?callbackUrl=%2Fdownload` | `307 → /download` | ✅ |
| 24 | **Member** `GET /register` | `307 → /dashboard` | ✅ |
| 25 | `/login?callbackUrl=/download` renders **Access Restricted** + *"Please activate your account first."* + Activate Account → `/register` | ✅ | ✅ |
| 26 | `/download` renders **Android Terminal APK** / **Version 1.0.0** | ✅ | ✅ |
| 27 | SHA-256 rendered on `/download` **equals** the bytes served by `/api/download` | ✅ | ✅ |
| 28 | Downloaded file is a valid ZIP container | ✅ | ✅ |
| 29 | `POST /api/referral/capture` with a valid code sets httpOnly `cpc_ref` | ✅ | ✅ |
| 30 | `cpc_ref` is **consumed and cleared** during provisioning | ✅ | ✅ |
| 31 | Referral attribution persisted to `users.referred_by_id` | ✅ | ✅ |
| 32 | Sign-in writes a real `users` row with a generated `referral_code` | ✅ | ✅ |
| 33 | Each download writes a `download_logs` row (version, platform, UA, ip_hash) | ✅ | ✅ |
| 34 | `/register?ref=…` prefills the field and reports *"Aarav will be credited"* | ✅ | ✅ |
| 35 | `Self-referral rejected` server-side | ✅ | ✅ |
| 36 | Download counts increment per member in Postgres | ✅ | ✅ |

### Real-browser end-to-end (Playwright · Chromium 141 · final build)

27 assertions across the complete journey, re-run against the final production
build on **02 Oct 2026** — **27 ✅ / 0 ❌, 0 console errors**.

| # | Interaction | Result |
|---|---|---|
| 1 | Guest opens `/download` → lands on `/login`, copy reads *"Access Restricted"* + *"Please activate your account first."* | ✅ |
| 2 | The gate names the blocked route (`Gated route: /download`) and its button targets `/register` | ✅ |
| 3 | `/register?ref=CRC-ARCH1TEC` prefills the field and validates via `GET /api/referral` → *"Aarav will be credited"* | ✅ |
| 4 | `POST /api/referral/capture` sets the httpOnly `cpc_ref` cookie | ✅ |
| 5 | Submitting the form provisions a member → redirected to `/dashboard` | ✅ |
| 6 | Dashboard renders the generated `CRC-XXXXXXXX` code, *"Registration Active"*, the membership tier and the share link | ✅ |
| 7 | Copy-to-clipboard writes the **exact** code back to the clipboard | ✅ |
| 8 | Signed-in visit to `/login` redirects to `/dashboard` | ✅ |
| 9 | Download Center unlocked → *"Access Granted"*, **Android Terminal APK**, **Version 1.0.0**, mirror URL, SHA-256, demo-artifact warning | ✅ |
| 10 | Installation Guide modal opens with *"Installing the Android Terminal"*; `Escape` closes it | ✅ |
| 11 | Clicking Download saves `app-release.apk` through the browser (1 701 bytes) | ✅ |
| 12 | Mobile drawer opens at 390 px and exposes *Activate Account* | ✅ |
| 13 | A11y: skip-to-content target `#main` exists, exactly one `<h1>`, every `<img>` has an `alt` attribute | ✅ |
| 14 | **Console errors across the whole run** | **0** ✅ |

### Post-run data checks

| Check | Result |
|---|---|
| Guest `GET /downloads/app-release.apk` (static mirror) | `307` → gated ✅ |
| Member `GET /downloads/app-release.apk` | `200`, `application/vnd.android.package-archive` ✅ |
| SHA-256 of the mirror bytes equals the shipped artifact | match ✅ |
| `npx tsx prisma/seed.ts` run three times — `users` row count | `8 → 8 → 8` ✅ |
| Seed `download_logs` after three seed runs | exactly `11` (no duplicate writes) ✅ |

> The seed script is idempotent by `upsert` on `google_id`; re-running it
> refreshes the demo rows in place rather than appending duplicates.

### Environment

| Component | Version |
|---|---|
| Node.js | v20.20.2 |
| npm | 10.8.2 |
| Next.js | 15.5.27 (App Router, Turbopack off) |
| React | 19.3.0 |
| NextAuth.js | 4.24.15 |
| Prisma Client / CLI | 6.19.3 |
| PostgreSQL | 17.11 (Debian 17.11-0+deb13u1) |
| Vitest | 3.2.4 |
| Playwright / Chromium | 1.49.1 / build 1148 |
| Host | 2 vCPU, 1.9 GiB RAM |

The box is deliberately small. Two consequences shaped the workflow:
`next dev` and Chromium together exceed available memory, so the HTTP tier and
the browser run both execute against an already-built `next start`; and the
server is started with `NODE_OPTIONS="--max-old-space-size=640"` to leave room
for Postgres and the test runner.

### Reproducing this verification

```bash
# 1 — database + schema + seed (idempotent, safe to re-run)
npm run db:setup

# 2 — static checks
npm run typecheck        # tsc --noEmit, strict
npm run lint             # next lint, zero warnings

# 3 — pure unit tier (no database, no server)
npm run test:unit

# 4 — build and serve the production bundle
npm run build
NODE_OPTIONS="--max-old-space-size=640" npx next start -H 0.0.0.0 -p 3000 &

# 5 — integration tier: live Postgres + live HTTP
npm run test:integration

# or everything at once
npm run verify
```

Every result in this section was produced by exactly that sequence.
