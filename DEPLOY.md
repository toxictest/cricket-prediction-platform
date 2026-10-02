# Free Deployment Guide — Vercel + Neon

This deploys the full application to a public HTTPS URL for **₹0 / $0 per
month**. Two free services are needed because Vercel is serverless and does not
include a database.

| Layer | Service | Free tier | Why |
|---|---|---|---|
| App hosting | **Vercel Hobby** | Unlimited deploys, 100 GB bandwidth/mo | Built by the Next.js team; zero-config for this stack |
| PostgreSQL | **Neon** | 0.5 GB storage, 1 project | Real Postgres 17, SSL, no credit card |
| Source | **GitHub** | already done | `toxictest/cricket-prediction-platform` (private) |

Total time: **about 10 minutes.**

---

## Step 1 — Create the free Postgres database (Neon)

1. Go to **https://neon.tech** and click **Sign up** → continue with GitHub.
2. Click **New Project**.
   - **Name:** `cricket-platform`
   - **Region:** `Asia Pacific (Singapore)` — lowest latency from India, or
     `AWS ap-south-1 (Mumbai)` if offered.
   - **Postgres version:** 17
3. On the project dashboard, open **Connection Details** and copy the string.
   It looks like:

   ```
   postgresql://neondb_owner:npg_XXXXXXXX@ep-cool-name-12345678.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

4. **Append `&schema=public`** to the end, so Prisma resolves the schema
   unambiguously:

   ```
   postgresql://neondb_owner:npg_XXXXXXXX@ep-cool-name-12345678.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&schema=public
   ```

   ⬆️ **This exact string becomes `DATABASE_URL` in Step 3. Keep the tab open.**

> **Pooled vs direct connection.** Neon also offers a *Pooled* connection whose
> host contains `-pooler`. Prisma needs the extra parameter `?pgbouncer=true`
> on that endpoint, and `prisma migrate deploy` needs a direct connection
> anyway. **Use the direct (non-pooled) hostname** — it is simpler and correct
> for this app's traffic. Only switch to pooled + `pgbouncer=true` if you later
> hit connection-limit errors under real load.

---

## Step 2 — Generate a production auth secret

NextAuth signs session JWTs with this. It must be unique to production and must
**never** be the development value.

```bash
openssl rand -base64 32
```

Copy the output — this is `NEXTAUTH_SECRET`.

---

## Step 3 — Import the repository into Vercel

1. Go to **https://vercel.com** → **Sign up** → **Continue with GitHub**.
   Choose the **Hobby** plan (free, no card required).
2. On the dashboard click **Add New… → Project**.
3. Under *Import Git Repository*, find **`cricket-prediction-platform`** and
   click **Import**. (If it is not listed, click *Adjust GitHub App
   Permissions* and grant access to this one repository — private repos are
   fully supported on Hobby.)
4. Vercel auto-detects **Next.js**. Leave these as-is:
   - **Framework Preset:** `Next.js`
   - **Root Directory:** `./`
   - **Build Command:** *(leave empty — see the note below)*
   - **Output Directory:** *(leave empty)*

> **Why the build command can stay empty:** the repository contains a
> `vercel-build` script, which Vercel automatically prefers over `build`:
>
> ```
> prisma generate && prisma migrate deploy && next build
> ```
>
> That means **the database schema is created automatically on every deploy** —
> there is no separate migration step to run. This only works because the
> `vercel-build` script exists; do not overwrite the Build Command field.

5. **Before clicking Deploy**, expand **Environment Variables** and add every
   row from Step 4.

---

## Step 4 — Environment variables

Add these in the Vercel *Environment Variables* panel. Tick **Production**,
**Preview** and **Development** for each.

| Key | Value | Required |
|---|---|---|
| `DATABASE_URL` | The Neon string from Step 1 | **Yes** |
| `NEXTAUTH_SECRET` | The `openssl rand -base64 32` output | **Yes** |
| `NEXTAUTH_URL` | `https://<your-app>.vercel.app` | **Yes** |
| `NEXT_PUBLIC_SITE_URL` | same value as `NEXTAUTH_URL` | **Yes** |
| `GOOGLE_CLIENT_ID` | from Google Cloud Console | See Step 6 |
| `GOOGLE_CLIENT_SECRET` | from Google Cloud Console | See Step 6 |
| `APK_FILE_NAME` | `app-release.apk` | No |
| `APK_VERSION` | `1.0.0` | No |
| `REFERRAL_CODE_LENGTH` | `8` | No |
| `REFERRAL_CODE_PREFIX` | `CRC` | No |
| `NEXT_PUBLIC_APK_DOWNLOAD_URL` | *(leave empty)* | No |
| `NEXT_PUBLIC_CONTACT_EMAIL` | your real support address | **Yes for a public site** |
| `NEXT_PUBLIC_SECURITY_EMAIL` | your security address | No |

Do **not** set `SHADOW_DATABASE_URL`. That variable is only used by
`prisma migrate dev` on a local machine; Neon and Vercel do not need it.

`NEXTAUTH_URL` must match the deployed origin **exactly** — `https://`, no
trailing slash. If it is wrong, sign-in fails with a redirect or CSRF error.

### ⚠️ Google credentials are not optional

This build is **Google-only**. The email/password developer channel that used to
allow testing before OAuth existed has been removed, so `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are the only way in.

If you deploy before configuring them:

- `/login` and `/register` render a **"No sign-in method is configured"** panel.
- Nobody — including you — can create an account or reach `/dashboard`.

That is the intended failure mode: it is loud and safe, rather than silently
leaving a bypass channel open on a public URL. Complete Step 6 before sharing
the link.

## Step 5 — Deploy

Click **Deploy**. The first build takes roughly 1–3 minutes and does this:

1. `npm install` → runs `postinstall` → `prisma generate`
2. `vercel-build` → `prisma migrate deploy` → **creates every table in Neon**
3. `next build` → compiles all 12 routes

When it finishes, open the URL. You should see the landing page with the
fire-particle background.

### The database starts empty — that is correct

There is no seed script. Every row in `users` comes from a real Google sign-in,
which is the point: the member count on the landing page and the referral graph
on the dashboard are measurements, not fixtures.

After your first sign-in, `/` should read **1 member, 0 referred** and the
dashboard should show a real referral code. If the counts stay at zero, the
sign-in did not complete — check the Vercel function logs.

---

## Step 6 — Make real Google logins work

Until you complete this step **nobody can sign in** — Google is the only
provider registered. To configure it:

1. Open **https://console.cloud.google.com/apis/credentials**
2. If prompted, create a project (e.g. `cricket-platform`).
3. **Create Credentials → OAuth client ID** → Application type:
   **Web application**.
4. Under **Authorized JavaScript origins**, add:

   ```
   https://<your-app>.vercel.app
   ```

5. Under **Authorized redirect URIs**, add — keeping your existing localhost
   entry so local development keeps working:

   ```
   https://<your-app>.vercel.app/api/auth/callback/google
   http://localhost:3000/api/auth/callback/google
   ```

6. Click **Create**, then copy the **Client ID** and **Client Secret**.
7. In Vercel → *Settings → Environment Variables*, set `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`.
8. Go to *Deployments → ⋯ → Redeploy* so the new values are picked up.

Environment-variable changes only apply to **new** deployments — always
redeploy after editing them.

---

## Step 7 — Post-deploy smoke test

Replace `<app>` with your domain and run:

```bash
# 1. Health — expects {"ok":true,...,"database":"connected"}
curl -s https://<app>.vercel.app/api/health

# 2. Guest hitting the dashboard must be redirected, not shown content
curl -s -o /dev/null -w '%{http_code}\n' https://<app>.vercel.app/dashboard
#    expect: 307

# 3. The static APK mirror must ALSO be gated (this is the subtle one)
curl -s -o /dev/null -w '%{http_code}\n' https://<app>.vercel.app/downloads/app-release.apk
#    expect: 307

# 4. The download API must refuse anonymous callers with the product copy
curl -s https://<app>.vercel.app/api/download
#    expect: {"ok":false,"error":"Access restricted. Please activate your account first.","code":"UNAUTHORIZED"}

# 5. robots.txt must disallow the private areas
curl -s https://<app>.vercel.app/robots.txt | grep -i disallow
```

If **#1** reports `database: "disconnected"`, `DATABASE_URL` is wrong or the
Neon project is suspended. If **#3** returns `200`, the middleware matcher is
not running — that would be a real bug worth reporting.

---

## Updating the deployed site

Because Vercel is connected to the repository, every push to `main` triggers a
new deployment automatically:

```bash
git add -A
git commit -m "your change"
git push
```

Preview deployments are created for other branches and pull requests.

---

## What is NOT free / not included

| Item | Reality |
|---|---|
| Custom domain | The `*.vercel.app` subdomain is free. A custom domain is free to *host* but you pay a registrar for the name. |
| Real APK | No APK ships in the repository. Until you stage one at `storage/apk/app-release.apk`, `/download` shows "No build staged" and `/api/download` returns `503`. See README §9. |
| Horizontal rate limiting | `/api/referral` uses an in-memory limiter. On serverless, every warm instance keeps its own counters, so the effective limit is roughly *N instances × 30 requests*. Acceptable here; use Upstash Redis if it ever matters. |
| Neon idle | The free Neon compute scales to zero after ~5 minutes idle. The first request afterwards takes ~1 s to wake. |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Error: P1001: Can't reach database server` | Wrong `DATABASE_URL`, or Neon suspended | Re-copy the string from Neon; confirm `?sslmode=require` is present |
| `P1012` / schema validation error at build | `prisma generate` ran with a stale or malformed schema | Check the build log; the schema itself is committed and valid |
| Sign-in redirects to `/login` in a loop | `NEXTAUTH_URL` does not match the deployed origin | Set it to the exact `https://…vercel.app` URL, no trailing slash, then redeploy |
| `redirect_uri_mismatch` from Google | Redirect URI not registered | Add `https://<app>/api/auth/callback/google` exactly, then wait ~1 minute for propagation |
| `Configuration` error on the sign-in page | `NEXTAUTH_SECRET` missing | Set it in Vercel and redeploy |
| Build succeeds but tables are missing | `vercel-build` was overridden by a custom Build Command | Clear the Build Command field in *Settings → Build & Development* |
| `prepared statement "s0" already exists` | Using Neon's pooled endpoint without `pgbouncer=true` | Switch `DATABASE_URL` to the direct hostname (Step 1) |

---

## Alternative free hosts

| Host | Free tier | Verdict for this project |
|---|---|---|
| **Vercel** | Hobby, generous | **Recommended** — native Next.js support |
| **Netlify** | Free, Next.js runtime | Works, but the Next.js adapter is less faithful |
| **Render** | Free web service | Free instances sleep after 15 min and cold-start in ~50 s; Docker deploy required for this stack |
| **Railway** | Trial credits only | No longer a lasting free tier |
| **Fly.io** | Pay-as-you-go allowance | Needs a card on file |

Whatever you choose, the database still needs to live somewhere reachable —
Neon, Supabase, or Turso all have free Postgres tiers.
