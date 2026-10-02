# File Manifest

Every source file in the project, with what it does and why it exists.
**77 tracked files · ~13,000 lines of hand-written source.**

Legend: 🎨 UI · ⚙️ logic · 🔒 security-relevant · 📄 docs/config

---

## Configuration (root)

| File | Purpose |
|---|---|
| 📄 `package.json` | Pinned dependency tree. Next **15.5.27**, React **19.3.0**, Prisma **6.19.3**, NextAuth **4.24.15**. 21 scripts — see the table at the bottom. |
| 📄 `tsconfig.json` | TypeScript strict mode, `@/*` → `./src/*` path alias, `bundler` resolution. |
| 📄 `next.config.ts` | Security headers (HSTS, nosniff, frame-options, permissions-policy), Google avatar allow-list, `serverExternalPackages` for Prisma, and forced `application/vnd.android.package-archive` + `no-store` on `/downloads/*`. |
| 📄 `tailwind.config.ts` | The whole design system: the `cyber.*` palette, 16 keyframes (fire flicker, grid drift, scanline, ember rise, caret blink…), neon box-shadows, cyber grid backgrounds. |
| 📄 `postcss.config.mjs` | Tailwind + Autoprefixer. |
| 📄 `.eslintrc.json` | `next/core-web-vitals` + `next/typescript`, `_`-prefixed unused-arg escape hatch. |
| 📄 `components.json` | shadcn/ui CLI config (`new-york`, RSC, zinc). |
| 📄 `vitest.config.ts` | Two test tiers, single-fork pool for constrained containers, `@/*` alias, `tests/setup.ts` env bootstrap. |
| 📄 `.env.example` | Every variable, documented, with instructions for generating secrets. |
| 📄 `.env` | Local values (git-ignored). Prisma CLI reads this file, **not** `.env.local`. |
| 📄 `.gitignore` | Excludes `.env`, `.next`, `node_modules`, and `storage/apk/*.apk` (release binaries must never be committed). |

---

## Database

| File | Purpose |
|---|---|
| ⚙️ `prisma/schema.prisma` | Two models. `User` (id, googleId, name, email, image, referralCode, referredById, lastLoginAt, timestamps) and `DownloadLog` (version, platform, ipHash, userAgent). PascalCase in TS, `snake_case` in Postgres via `@map`. Five indexes, cascade/set-null rules. |
| ⚙️ `prisma/migrations/20261002122519_init/migration.sql` | The applied DDL. Use `prisma migrate deploy` in CI rather than `db push`. |
| ⚙️ `prisma/seed.ts` | Seven-member demo network with a referrer→invitee graph and 11 download-log rows. Idempotent: re-running upserts by `googleId`. Refuses to run when `NODE_ENV=production`. |

---

## Scripts

| File | Purpose |
|---|---|
| ⚙️ `scripts/setup-dev-db.sh` | **One-command environment bootstrap.** Finds or installs PostgreSQL, initialises a cluster if none exists, creates the role/database/shadow-database, generates `.env` with a fresh `NEXTAUTH_SECRET`, applies migrations, optionally seeds. Idempotent; `--reset` drops first. Deliberately calls `./node_modules/.bin/prisma` rather than `npx prisma`, which would silently resolve to Prisma 7 and reject this schema. |
| ⚙️ `scripts/make-placeholder-apk.mjs` | Zero-dependency ZIP writer. Emits a valid, compressed container holding `README.txt`, `BUILD_INFO.json` and `NOT_AN_INSTALLABLE_BUILD.txt` so the gate, audit log and stream path are exercisable before a real Android build exists. Not installable — and labelled as such everywhere. |

---

## Application shell

| File | Purpose |
|---|---|
| 🎨 `src/app/layout.tsx` | Root layout. Self-hosts Inter / JetBrains Mono / Orbitron via `next/font`, declares metadata + viewport + theme colour, mounts `CyberBackground`, `Providers` and the skip-to-content link. |
| 🎨 `src/app/globals.css` | The design system in CSS: HSL tokens for shadcn, glassmorphism (`.glass`, `.glass-strong`), neon borders, corner brackets, terminal chrome, clip paths, scrollbars, focus rings, and a blanket `prefers-reduced-motion` reset. |
| 🎨 `src/app/page.tsx` | Landing page (RSC). Reads the session server-side so the closing CTA can address returning members, and lazy-loads the below-fold CTA via `next/dynamic`. |
| 🎨 `src/app/loading.tsx` | Terminal-styled route fallback. |
| 🎨 `src/app/error.tsx` | Route error boundary. Surfaces `error.digest` so a support ticket can be matched to a log line. |
| 🎨 `src/app/global-error.tsx` | Root boundary. Must render its own `<html>`/`<body>` and uses inline styles only — no Tailwind, no fonts. |
| 🎨 `src/app/not-found.tsx` | 404. |
| 📄 `src/app/robots.ts` | Disallows `/dashboard`, `/download`, `/downloads/`, `/api/`; blocks GPTBot and CCBot outright. |
| 📄 `src/app/sitemap.ts` | Public routes only — gated paths would only create soft-404s in Search Console. |
| 📄 `src/app/manifest.webmanifest` | PWA metadata, `#09090b` theme. |
| 🎨 `src/app/icon.svg` | Hand-authored SVG icon: gradient terminal caret plus a dashed cricket-ball seam. |

---

## Authentication

| File | Purpose |
|---|---|
| 🔒 ⚙️ `src/lib/auth.ts` | `authOptions`: Google provider, optional credentials provider, JWT strategy (30 days), `signIn` / `jwt` / `session` / `redirect` callbacks, and the 15 mapped error codes. **Documents why `useSecureCookies` must not be overridden** — NextAuth derives the cookie name from the `NEXTAUTH_URL` protocol, and `next-auth/middleware` cannot see the option, so overriding it desynchronises the server from the edge and loops every gated route. |
| 🔒 ⚙️ `src/middleware.ts` | Composed edge middleware. Referral capture, auth-page bounce, then delegation to `withAuth`. Composed rather than a bare `withAuth` because `next-auth@4` returns early for `pages.signIn` **before invoking the callback**, making it impossible to bounce signed-in members off `/login` from inside the gate. |
| 🔒 ⚙️ `src/lib/user.ts` | `provisionUser()` — the single write path for new members. Normalises email/name/avatar, handles the returning-member and first-registration branches, retries on `P2002`, rejects self-referral. Plus `getUserOverview()` (dashboard aggregate) and `recordDownload()`. |
| 🔒 ⚙️ `src/lib/referral.ts` | Code generation and resolution. 30-character ambiguity-free alphabet, `crypto.randomInt` for unbiased rejection sampling, `findUnique` pre-check, retry-on-collision, `normalizeReferralCode`, `validateReferralCode`. |
| ⚙️ `src/types/next-auth.d.ts` | Module augmentation so `session.user.id`, `.referralCode` and `.registeredAt` are typed end to end. |
| 🎨 `src/components/auth/auth-shell.tsx` | Two-column layout shared by `/login` and `/register`. A Server Component — only the form itself is a client island. |
| 🎨 `src/components/auth/login-form.tsx` | Google button with an inline SVG mark (no network request), 15 error codes rendered as human explanations, developer access panel. |
| 🎨 `src/components/auth/register-form.tsx` | Debounced referral validation, "what gets stored" disclosure, referral-cookie hand-off before the OAuth redirect. |
| 🎨 `src/components/auth/access-notice.tsx` | The **Access Restricted / "Please activate your account first."** banner shown on `/login` when the middleware bounced a guest away from a gated route. |

---

## Pages

| File | Purpose |
|---|---|
| 🎨 `src/app/login/page.tsx` | RSC shell. Redirects authenticated users, detects a gated `callbackUrl` to render the access notice, reads the referral cookie, and wraps the form in `Suspense` (`useSearchParams` needs a boundary). |
| 🎨 `src/app/register/page.tsx` | Same pattern, oriented around provisioning. |
| 🎨 `src/app/dashboard/page.tsx` | Member console: profile card, four live stat tiles read from Postgres, membership-tier progress, referral code + share link, referral network, download shortcut. |
| 🎨 `src/app/download/page.tsx` | Download Center. Resolves the artifact, hashes the bytes on disk, renders specs/checksum/audit log, and falls back to `<AccessRestricted />` if the session or member record vanished. |
| 🎨 `src/app/(legal)/layout.tsx` | Shared shell for the policy routes (route group adds no URL segment). |
| 🎨 `src/app/(legal)/terms/page.tsx` | Ten-section ToS. |
| 🎨 `src/app/(legal)/privacy/page.tsx` | Nine-section policy that mirrors the actual Prisma schema — including the `ip_hash` design and the three cookies the app sets. |
| 🎨 `src/app/(legal)/responsible-play/page.tsx` | 18+ guidance, warning signs, and real Indian + international helplines (Tele-MANAS 14416, Kiran, AASRA, GamCare). |
| 🎨 `src/app/(legal)/contact/page.tsx` | Three support channels plus four self-service diagnostics. |

---

## API routes

| File | Purpose |
|---|---|
| 🔒 `src/app/api/auth/[...nextauth]/route.ts` | NextAuth handler. `runtime = "nodejs"` — the `signIn` callback writes to Postgres via Prisma, which cannot run on Edge. |
| 🔒 `src/app/api/download/route.ts` | **The real gate.** Verifies the session, writes the audit row, then streams the APK via `Readable.toWeb()` so an 18 MB file is never buffered. Redirects to a CDN when `NEXT_PUBLIC_APK_DOWNLOAD_URL` is set. `405` on `POST`. |
| ⚙️ `src/app/api/health/route.ts` | Liveness + readiness (`SELECT 1`). `200`/`503`, never leaks the connection string. |
| ⚙️ `src/app/api/session/route.ts` | Canonical "who am I", reading live referral and download counts rather than trusting the JWT. |
| 🔒 `src/app/api/referral/route.ts` | Public code validation. Sliding-window limiter (30/min/IP) with documented caveats on per-process state and `x-forwarded-for` trust. Reveals only the referrer's first name. |
| 🔒 `src/app/api/referral/capture/route.ts` | Validates then stores the code in the httpOnly `cpc_ref` cookie so it survives the OAuth round-trip. `DELETE` clears it. |

---

## Library

| File | Purpose |
|---|---|
| ⚙️ `src/lib/prisma.ts` | HMR-safe singleton client. Without it, dev-mode reloading opens a new pool per request and exhausts `max_connections`. |
| ⚙️ `src/lib/artifact.ts` | Locates the APK (`storage/apk` → `public/downloads` → CDN) and **computes its SHA-256 from the bytes on disk**, so the published checksum always matches the file the member receives. Detects the demo placeholder by size. Memoised per process. |
| ⚙️ `src/lib/constants.ts` | Single source of truth for content: nav, features, protocol steps, pillars, stats, FAQ, footer, app-release metadata, membership tiers. |
| ⚙️ `src/lib/utils.ts` | `cn` (clsx + tailwind-merge), `formatDate`, `formatDateTime`, `timeAgo`, `maskEmail`, `absoluteUrl`, `initials`, `clamp`, `uid`. |
| ⚙️ `src/types/index.ts` | Shared domain types, the `ApiResponse<T>` envelope and its error-code union. |

---

## Effects & animation

| File | Purpose |
|---|---|
| 🎨 `src/components/effects/fire-particle-canvas.tsx` | **The fire background.** One canvas, additive `mix-blend-screen`, six-stop colour ramp, radial-gradient sprites, in-place particle recycling (zero per-frame allocation), DPR capped at 2, density scaled by viewport, RAF paused when the tab is hidden, static frame under `prefers-reduced-motion`, full teardown on unmount. |
| 🎨 `src/components/effects/cyber-background.tsx` | Layered backdrop: animated grid → glow orbs → fire canvas → film grain → scanlines → vignette. Grain is an inline SVG `feTurbulence` data URI, so it renders with no network request. |
| 🎨 `src/components/effects/terminal-window.tsx` | Types lines out character by character with a blinking caret. `role="log"` + `aria-live="polite"`. |
| 🎨 `src/components/effects/reveal.tsx` | `Reveal`, `StaggerGroup`, `StaggerItem`, `TypewriterText`, `GlitchText` — all no-ops under reduced motion. |
| 🎨 `src/components/effects/section-heading.tsx` | Consistent eyebrow/title/description header with a pulsing status dot. |

---

## UI primitives (shadcn)

| File | Purpose |
|---|---|
| 🎨 `button.tsx` | Eight variants (`default`, `neon`, `cyber`, `outline`, `secondary`, `ghost`, `link`, `destructive`), clip-path sizing, and a `loading` prop that preserves the label so the control never changes width. |
| 🎨 `card.tsx` | Neutral `Card` plus the `GlassCard` cyberpunk preset (blur, neon hairline, corner brackets, hover lift). |
| 🎨 `badge.tsx` | Ten semantic variants with a glow per status. |
| 🎨 `input.tsx` | Red-tinted focus ring, `aria-invalid` styling, optional terminal mono mode. |
| 🎨 `label.tsx` | Mono, uppercase, wide-tracked. |
| 🎨 `accordion.tsx` | Radix accordion with a `+` that rotates to `×`; shell-prompt affordance. |
| 🎨 `avatar.tsx` | Neon-bordered square avatar with a mono initials fallback. |
| 🎨 `progress.tsx` | Optional label row; gradient fill with a glow. |
| 🎨 `dialog.tsx` | Portal, overlay, close button, header/footer/title/description. |
| 🎨 `separator.tsx` | Gradient hairline rather than a flat border. |
| 🎨 `skeleton.tsx` | Red-tinted shimmer instead of a neutral pulse. |
| 🎨 `tooltip.tsx` | Mono, neon-bordered, portal-rendered. |
| 🎨 `sonner.tsx` | Toast surface restyled to the terminal aesthetic. |

---

## Layout & sections

| File | Purpose |
|---|---|
| 🎨 `src/components/layout/navbar.tsx` | Sticky nav with a scroll-progress rail, glass-on-scroll, smooth anchor scrolling with header offset, animated mobile drawer with staggered links, session-aware actions, and the shared `Logo`. |
| 🎨 `src/components/layout/footer.tsx` | Four-column footer, status strip linking `/api/health`, and the 18+/responsible-play notice. |
| 🎨 `src/components/sections/hero.tsx` | Headline, subtitle, both CTAs, trust row, stat row, and a live boot-log terminal that ends by announcing the access gate. |
| 🎨 `src/components/sections/features.tsx` | Six-card grid with per-card accent colours, animated bottom rails and corner brackets. |
| 🎨 `src/components/sections/about.tsx` | Narrative + six pillars + a platform-topology panel that reveals rows on intersection. |
| 🎨 `src/components/sections/how-it-works.tsx` | Four-step protocol on a connecting rail, each with the literal CLI command, closing in a CTA strip. |
| 🎨 `src/components/sections/faq.tsx` | Eight-question accordion plus a sticky diagnostics rail. |
| 🎨 `src/components/sections/final-cta.tsx` | Closing CTA that adapts to session state (register → or → download). |

---

## Feature components

| File | Purpose |
|---|---|
| 🎨 `src/components/download/access-restricted.tsx` | Renders **"Access Restricted" / "Please activate your account first."** with a terminal transcript of the actual `401` response and an Activate Account button pointing at `/register`. Three variants for different refusal reasons. |
| 🎨 `src/components/download/download-button.tsx` | A real `<a download>` anchor so the browser's own download manager, progress UI and resume work. Plus `MirrorLink` and `ChecksumRow`. |
| 🎨 `src/components/download/install-guide.tsx` | Five-step sideload modal with a checklist you can tick off and copy-ready `sha256sum` / `Get-FileHash` / `adb install` commands. |
| 🎨 `src/components/dashboard/referral-panel.tsx` | Referral network list, empty state, and Web Share API with a clipboard fallback. |
| 🎨 `src/components/shared/copy-button.tsx` | Clipboard with a `document.execCommand` fallback for non-secure origins (plain-HTTP LAN testing). |
| 🎨 `src/components/shared/legal-article.tsx` | Long-form renderer that generates a sticky table of contents from its section list. |
| 🎨 `src/components/providers.tsx` | The single client boundary: `SessionProvider` + `TooltipProvider` + `Toaster`. |

---

## Tests — 100 passing

| File | Count | Covers |
|---|---|---|
| ⚙️ `tests/setup.ts` | — | Loads `.env.local` → `.env.test` → `.env` (Vitest does not do this the way Next.js does), and supplies fallback secrets. |
| ⚙️ `tests/referral.test.ts` | 15 | Alphabet safety, **a uniformity check that proves unbiased sampling**, length handling, uniqueness across 5 000 draws, normalisation idempotence. |
| ⚙️ `tests/utils.test.ts` | 22 | `cn` Tailwind conflict resolution, date formatting incl. invalid input, `timeAgo` buckets, email masking (asserts no leakage), `absoluteUrl` slash handling, initials, clamp, uid. |
| ⚙️ `tests/artifact.test.ts` | 6 | Real SHA-256 shape, determinism, size-label format, placeholder detection, memoisation, field-shape contract. |
| ⚙️ `tests/provisioning.test.ts` | 24 | Against live Postgres: creation, idempotent re-login, email casing, name fallback, avatar sanitising, distinct codes, referral linking, **self-referral blocked**, late attribution, P2002 on all three unique constraints, cascade delete, SET NULL detach. Namespaced fixtures with teardown. |
| ⚙️ `tests/http-contract.test.ts` | 33 | Against a running server: every public route, 404, the guest gate on all three protected paths, `401` copy, `405`, artifact non-leakage, referral API semantics, per-client rate limiting, security headers, provider list not leaking secrets. |

---

## Documentation

| File | Purpose |
|---|---|
| 📄 `README.md` | 18-section guide: features, stack, quick start, env vars, Google OAuth, the developer channel, database, artifact handling, full file structure, routes/API, **how the gate works**, design system, deployment (Vercel + Docker + checklist), security, scripts, troubleshooting, and the verification log. |
| 📄 `FILE_MANIFEST.md` | This file. |
| 📄 `storage/apk/README.md` | Explains the private staging directory and why it is preferred over `public/`. |
| 📄 `docs/screenshots/*.png` | 16 captures taken from the running application (landing sections, auth, the guest gate, the unlocked Download Center, dashboard, and three mobile widths). |

---

## Scripts reference

| Script | Command |
|---|---|
| `npm run dev` | `next dev` |
| `npm run build` | `prisma generate && next build` |
| `npm start` | `next start` |
| `npm run lint` | `next lint` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | `vitest` (watch) |
| `npm run test:run` | `vitest run` |
| `npm run test:unit` | Unit tier only — no DB, no server, ~0.6 s |
| `npm run test:integration` | DB + HTTP tiers |
| `npm run verify` | `typecheck && lint && test:run && build` |
| `npm run db:setup` | **Bootstrap Postgres + migrate + seed** |
| `npm run db:setup:reset` | Same, dropping databases first |
| `npm run db:generate` | `prisma generate` |
| `npm run db:push` | `prisma db push` |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:deploy` | `prisma migrate deploy` |
| `npm run db:studio` | `prisma studio` |
| `npm run db:seed` | `tsx prisma/seed.ts` |
| `npm run db:reset` | `prisma migrate reset --force` |
| `npm run apk:placeholder` | Generate the demo artifact |
