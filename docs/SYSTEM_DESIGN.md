# System Design: Cricket Prediction Community Platform

| | |
|---|---|
| Status | Draft v0.1, for review (not approved) |
| Date | 2026-10-09 |
| Baseline | Commit `66ad299` plus migration `20261009114731_add_admin_wallet_match_ledger` |
| Companion | `cricket-platform-review.md` (code review, findings C1–L5) |

---

## 0. Summary

- **As built today:** Google sign-in, referral codes, a gated APK download with an audit log, a legal and marketing site, admin login with RBAC (Phase 2), a wallet ledger service with member and admin read APIs (wallet change), the deposit request system (a member reads the match QR, files a UTR claim, and a payment reviewer approves or rejects it), the withdrawal system (a member asks for winnings to a UPI ID, the tokens are cut at filing, and a reviewer confirms the payout or refuses it and returns the tokens) (payment and withdrawal changes), match management with live scoring (an admin creates and edits fixtures and posts a scoreboard; members read what is being played, cached and revalidatable) (match change), and `GET /api/me`, the one member-facing snapshot call: profile, balances, referral and download counters (this change). **This change adds the first staff UI:** an admin panel at `/admin` on the existing cyberpunk design system — sign-in, a dashboard that reads the queues, and the deposit-claim review queue with approve and reject in a dialog. There are still **no** predictions: no pick, no settlement, no leaderboard. Five routes move or release value — approving or rejecting a deposit claim, and filing, approving or refusing a payout — and every one of them is behind `MONEY_MODE` (§13). Several docs and marketing claims describe features that do not exist (review C1–C5).
- **Data model:** 5 enums and 7 tables for admin users, wallets, payment claims, withdrawal requests, matches, live scores, and a transaction ledger (Phase 1). Then `admin_sessions` (Phase 2), the ledger guards in `add_wallet_ledger_guards` (wallet change), the queue indexes and CHECK constraints in `harden_payment_requests` (payment change) and `harden_withdrawal_requests` (withdrawal change), and `add_match_management` (match change), which adds `matches.external_id`, two match indexes, and eight CHECKs across `matches` and `live_scores` (§5.2d). Staff now have a UI for the money-in path (`/admin/login`, `/admin/dashboard`, `/admin/payments`); the payout queue, the fixture console, live score entry and the QR picker are API-only still, and every member-facing flow is API-only.
- **Legal gate (blocking):** Deposit, then wallet, then winnings, then withdrawal matches the shape of an "online money game" under the Promotion and Regulation of Online Gaming Act, 2025, in force from 1 May 2026 according to the sources in §2. Money paths stay off until counsel signs off.
- **Recommended direction:** Build the free-to-play prediction core first (matches, predictions, live scores, leaderboard, admin). Keep money modules behind a `MONEY_MODE` flag that defaults to off.

---

## 1. Goals and non-goals

**Goals (v1)**

1. Members predict match outcomes before the match starts. Predictions lock at `startTime`.
2. Members see a live scoreboard that updates within about 10 seconds of an admin or provider update.
3. Admins manage matches and enter scores. When money is enabled, admins also review money requests. Every admin write is audited.
4. Public pages make no claims that cannot be verified (fixes review C1–C4).

**Non-goals (v1)**

- Real-money contests, deposits, withdrawals, or any payout (blocked by §2 until legal sign-off).
- Ball-by-ball analytics, AI-generated predictions, native apps beyond the existing APK.
- Multi-region active-active deployment.

---

## 2. Legal and compliance gate

Secondary sources reviewed (not checked against the official gazette text):

- An "online money game" is any online game, whether skill, chance, or both, where a user pays fees or deposits money in expectation of monetary winnings. Virtual credits, tokens, and coins that are convertible to money are included ([1](https://legal.economictimes.indiatimes.com/news/industry/online-gaming-act-set-to-transform-indias-gaming-landscape-by-2026/130557038)). E-sports are excluded ([5](https://www.lexology.com/library/detail.aspx?g=67f5157a-fefc-4836-9f9f-97987c0174da)).
- Offering or operating an online money game carries imprisonment of up to 3 years and a fine of up to ₹1 crore for a first offence. Advertising such games is prohibited, with penalties of up to 2 years and ₹50 lakh ([5](https://www.lexology.com/library/detail.aspx?g=67f5157a-fefc-4836-9f9f-97987c0174da)).
- Banks and payment systems must block transactions for prohibited games ([3](https://onlinegamblers.org/licenses/india), [5](https://www.lexology.com/library/detail.aspx?g=67f5157a-fefc-4836-9f9f-97987c0174da)).
- Online social games are permitted only if they involve no stakes and no expectation of monetary gain ([2](https://www.ahlawatassociates.com/blog/online-gaming-act-2025-whats-banned-whats-not-e-sports-online-social-games)).
- The Act took effect on 1 May 2026 ([1](https://legal.economictimes.indiatimes.com/news/industry/online-gaming-act-set-to-transform-indias-gaming-landscape-by-2026/130557038), [3](https://onlinegamblers.org/licenses/india)).

**Design consequences**

| # | Rule (summary) | Consequence in this design |
|---|---|---|
| G1 | Paid entry or deposit, with expected winnings, is an OMG. Skill does not matter. | `MONEY_MODE` is implemented in `src/lib/feature-flags.ts`: filing a deposit claim, reviewing one, filing a payout request and reviewing one are all refused with 503 unless the flag is on, and an unset flag means off in production. Counsel's sign-off is still the precondition for turning it on — and a payout is the half that makes convertibility real, so it is the one to leave dark longest. |
| G2 | Non-cash "other enrichment" counts too. | Paid entry combined with any prize, cash or non-cash, is treated as high risk. |
| G3 | Tokens convertible to money count as stakes. | `winningBalance` and `tokensToCredit` belong to the same risk bucket. |
| G4 | Advertising OMGs is prohibited. | Marketing copy must not promise winnings, earnings, or "rewards" tied to paid play. |
| G5 | Banks and payment systems must block OMG transactions. | A UPI-manual deposit flow is not viable for an OMG without counsel's view. Plan for no payment gateway. |

**Questions for counsel (before any money feature or paid entry)**

1. Is free-to-play prediction with no entry fee and no cash, token, or merchandise reward outside the OMG definition?
2. Are sponsor-funded prizes given to all participants, with no fee, outside the definition?
3. Is a subscription with no winnings outside the definition?
4. What are the DPDP Act 2023 obligations (notice, consent, grievance officer, erasure), and are the privacy promises on the site (review C5) enforceable as written?
5. What is the tax treatment of any prize? Not researched here. Verify with a chartered accountant.

---

## 3. Current architecture (as built)

```
Browser ─► Next.js 15 App Router (Vercel)
            ├─ src/middleware.ts ............ route gate (/dashboard, /download, ...)
            ├─ /api/auth/[...nextauth] ..... Google OIDC only; JWT session 30 days; DB resync every 24 h
            ├─ /api/download ............... gate, then download_logs insert, then APK (local file or CDN link)
            ├─ /api/referral[/capture] ..... code lookup (in-memory rate limit on lookup only)
            ├─ /api/me ................... member snapshot: profile + balances + counters (session required)
            ├─ /api/wallet[/transactions] .. member balances and ledger (read-only, session required)
            ├─ /api/payment/qr, /request ... deposit QR and claim filing (session required, MONEY_MODE gated)
            ├─ /api/matches* ............. public fixture list, detail, live list, scoreboard (ETag + 5/15 s cache)
            ├─ /api/admin/payments* ........ review queue, approve, reject (requireAdmin + PAYMENT_ADMIN or SUPER_ADMIN)
            ├─ /api/admin/matches* ....... create, patch, list, score entry (requireAdmin + SUPER_ADMIN or SCORE_ADMIN)
            ├─ /api/admin/* ................ admin login, logout, me, member wallet view (requireAdmin on every route except login and logout)
            ├─ /admin/login ................ staff sign-in form (the only unguarded admin URL)
            ├─ /admin/(panel)/** ........... panel pages; `requireAdminPage()` in the group layout is the wall
            └─ /api/health ................. SELECT against PostgreSQL
PostgreSQL (Neon) ◄── Prisma 6.19.3 (src/lib/prisma.ts)
```

Key facts:

- **Provisioning:** `src/lib/user.ts` `provisionUser` creates a member on first sign-in. It allocates a `CRC-XXXXXXXX` referral code (`crypto.randomInt`, 30-character alphabet) and attributes the referrer once. Self-referral is blocked. The same write creates the member's zero-balance wallet, so a member never exists without one.
- **Build:** `vercel-build` runs `prisma generate && prisma migrate deploy && next build` (package.json).
- **APK distribution:** `*.apk` is gitignored and `storage/apk/` ships empty. Artifact resolution uses `process.cwd()` (review H1), so the download path does not work on Vercel as shipped.
- **Tests:** Vitest, 18 test files. Without a staged APK or a running server, 432 tests pass and 92 are skipped (test database; see Appendices C to H). With `next start` up against the development database the skips become runs: `tests/http-contract.test.ts` answers 83 checks over real HTTP, eleven of them about the admin panel's pages. Totals can move by one test between runs; Appendix G explains why.
- **Admin panel protection:** `middleware.ts` does not know about `/admin` and must not be asked to — it authenticates the *member* NextAuth cookie, while staff hold a separate `HttpOnly` admin cookie. The wall is `src/app/admin/(panel)/layout.tsx`, which calls `requireAdminPage()` on every request; each page that shows more than the shell re-checks its own roles (`checkAdminPage(REVIEW_ROLES)` on `/admin/payments`), and every write still goes through the guarded API route rather than through the page. `tests/admin-web.test.ts` asserts the tree itself, so a page added outside `(panel)` fails the suite.
- **CI:** none. The repo has no `.github/` directory.
- **Known gaps this design must close:** C1–C5 (claims and privacy promises) and H1–H7 (download path, login linking, share link, canonical URL, rate limiting).

---

## 4. Target architecture

```
 Members (Google SSO)                    Admins (email + password + TOTP)
        │                                            │
        ▼                                            ▼
 ┌──────────────── Next.js app (single deployable, modular monolith) ───────────────┐
 │ Member UI: /matches  /matches/[id]  /leaderboard  /dashboard  /download          │
 │ Admin UI:  /admin/*   (admin session + Role[] check)                             │
 │ API:       /api/v1/*  (zod validation · RBAC · rate limits · audit writes)       │
 └──────┬───────────────────────────┬──────────────────────────────┬────────────────┘
        │                           │                              │
  PostgreSQL (Neon)           Redis (optional, e.g. Upstash)   Private object storage
  source of truth             rate limits, score cache         proof images, APK builds
        ▲
        │ poll every 30–60 s during live matches (or admin push)
  Score ingest job ──► external cricket data provider (not yet chosen)
```

**Why a monolith:** one team, one deploy target (Vercel and Neon, already documented in `DEPLOY.md`), and modest expected load. Split only if score fan-out or admin tooling needs independent scaling.

| Component | Responsibility | Status |
|---|---|---|
| Member auth | Google OIDC, provisioning, referral attribution | Exists |
| Download gate | Auth, audit, short-lived link to the APK | Exists; needs H1–H3 fixes |
| Admin auth | Separate credentials (bcrypt), server-side admin sessions, `requireAdmin()` guard | Built: login, logout, me, guard. TOTP not built yet. |
| RBAC | Per-route `Role[]` check, deny by default | Designed. `Role` enum and `AdminUser.roles` exist. |
| Match service | CRUD and status transitions (UPCOMING → LIVE → COMPLETED) | Schema only |
| Score service | Versioned score writes, cached public reads | Schema only |
| Prediction service | Submit before lock, one per user per match, settlement | Not modelled yet (§5.5) |
| Leaderboard | Points per match and in total, recomputed on settlement | Not built |
| Money services (wallet, payments, withdrawals) | Ledger, approvals, reconciliation | Schema only. **Disabled** (§2). |
| Audit log | Record of every admin write | Not modelled yet (§5.5) |

---

## 5. Data model

### 5.1 Tables as built

- **`users`** (`User`): `id`, `googleId` (unique), `name`, `email` (unique), `image`, `referralCode` (unique), `referredById` (self-FK, SetNull), `lastLoginAt`, `createdAt`, `updatedAt`.
- **`download_logs`** (`DownloadLog`): `id`, `userId` (FK, Cascade), `version`, `platform`, `ipHash` (SHA-256 of secret + IP), `userAgent`, `createdAt`. Indexes on `(userId, createdAt)` and `(createdAt)`.

### 5.2 Tables added by migration `20261009114731_add_admin_wallet_match_ledger`

| Table | Purpose | Key constraints | Delete behaviour |
|---|---|---|---|
| `admin_users` | Operator accounts, separate from members | `email` unique; `roles Role[]` default `[]`; `isActive` | Reviewer and editor links → SET NULL |
| `admin_sessions` | One row per admin login. The admin cookie's JWT points at it. | `id` is a random UUID; `expires_at` is absolute; `revoked_at` is set on logout | Admin delete → CASCADE |
| `wallets` | One per member; cached deposit and winning balances | `user_id` unique; both balances ≥ 0 (CHECK) | User delete → **CASCADE** (see §5.5; recommend RESTRICT) |
| `payment_requests` | UPI deposit claims with UTR and screenshot | `utr_number` unique; status enum | User delete → RESTRICT; reviewer → SET NULL |
| `withdrawal_requests` | Payout requests to a UPI ID | status enum; `admin_utr` | User delete → RESTRICT; reviewer → SET NULL |
| `matches` | Fixtures | status enum; `start_time` | — |
| `live_scores` | One scoreboard per match | `match_id` unique; string scores | Match delete → CASCADE; last editor → SET NULL |
| `transactions` | Ledger of balance movements: signed `amount`, `balance_after` snapshot, `balance_type` enum | Unique `(user_id, type, reference_id)`; `amount <> 0` and `balance_after >= 0` (CHECK); index `(user_id, created_at)` | User delete → RESTRICT |

**Enums**

- `Role`: `SUPER_ADMIN`, `SCORE_ADMIN`, `PAYMENT_ADMIN`, `SUPPORT_ADMIN`
- `PaymentStatus` and `WithdrawalStatus`: `PENDING`, `APPROVED`, `REJECTED`
- `MatchStatus`: `UPCOMING`, `LIVE`, `COMPLETED`
- `TransactionType`: `DEPOSIT`, `WITHDRAWAL`, `WINNING`, `REFUND`, `ADMIN_ADJUST`
- `BalanceType`: `DEPOSIT`, `WINNING` (added by `add_wallet_ledger_guards`)

**Verified behaviour** (Appendix A): defaults; uniqueness; RESTRICT blocks deleting a user who has ledger or payment history; reviewer and editor links become NULL when the admin is deleted; deleting a match cascades to its live score; deleting a user with no history cascades to the wallet.

### 5.2a Wallet ledger changes: migration `20261009131042_add_wallet_ledger_guards`

- **Ledger shape.** `transactions.amount` is now signed. Credits are positive and debits are negative. `type` also implies the direction. `balance_after` records the affected balance right after the movement. `balance_type` changed from free text to the `BalanceType` enum. The column is converted in place with `USING`. Prisma's generated DDL would have dropped and re-added it.
- **Indexes.** `(user_id, created_at)` for history paging. A unique `(user_id, type, reference_id)`, so one payment, withdrawal, or match is applied once. Rows with a NULL reference are not constrained.
- **CHECK constraints.** `wallets.deposit_balance >= 0`, `wallets.winning_balance >= 0`, `transactions.amount <> 0`, and `transactions.balance_after >= 0`. Prisma cannot express these, so they live in the migration SQL.
- **Backfill.** Every existing user without a wallet gets a zero-balance wallet. Existing wallets are not changed. Backfilled ids are UUIDs. Prisma treats ids as opaque strings, so this is safe.
- **Precondition.** The migration stops if `transactions` already has rows, because `balance_after` cannot be backfilled. No application code wrote to the ledger before this change.

### 5.2b Payment queue support: migration `20261011091500_harden_payment_requests`

- **Indexes.** `payment_requests(user_id, created_at)` covers a member's own claims and the pending-count check that runs before a new claim is accepted. `payment_requests(status, created_at)` covers the review queue's filter and ordering. PostgreSQL does not index foreign-key columns by itself, so both paths were sequential scans before this.
- **CHECK constraints.** `payment_requests.amount > 0` and `payment_requests.tokens_to_credit > 0`. The service rejects those values first; the database makes the rule true for rows written by anything else, including a hand-run `psql` statement.
- **Precondition.** The migration stops if any existing row has a non-positive amount, rather than adding a constraint that would already be untrue.
- **No shape change.** `PaymentRequest` already had every column the flow needed, so this migration only adds indexes and constraints. That keeps it non-blocking for a deployed database.

### 5.2c Payout queue support: migration `20261011143000_harden_withdrawal_requests`

- **Indexes.** `withdrawal_requests(user_id, created_at)` covers a member reading their own payouts and the count that enforces `MAX_PENDING_PER_MEMBER`; `withdrawal_requests(status, created_at)` covers the review queue's filter and its newest-first order. Neither existed, so both were sequential scans.
- **CHECK constraint.** `withdrawal_requests.amount > 0`. The service refuses a payout of zero or of −500 tokens first; the constraint is what makes the same rule true for a row written by anything else, including a hand-run `psql` statement during an incident.
- **Precondition.** The migration counts non-positive rows and stops if it finds any, rather than adding a constraint that would already be untrue on a live database.
- **Units, and why the comment matters.** `WithdrawalRequest.amount` is a **token** count. `PaymentRequest.amount` is **rupees** and is multiplied by `TOKENS_PER_RUPEE` when a deposit is approved. Two columns with the same name and type in the same file, meaning two different things, is the kind of confusion that pays out 100× too much, so the model carries a comment saying which is which.

### 5.2d Match management and live scoring: migration `20261011153000_add_match_management`

- **`matches.external_id`, unique.** A score feed refers to a fixture by its own id. The unique index (partial, because the column is nullable) is what makes the same fixture arriving twice one row rather than two, and the API maps that conflict to 409 `DUPLICATE_MATCH` like the friendly same-teams-same-time check.
- **Indexes.** `matches(status, start_time)` serves the two questions the platform asks constantly — what is live, what is coming — and `matches(start_time, id)` is the pair every list pages on, so ordering by kick-off and seeking past the last row seen both stay index-only.
- **Eight CHECK constraints.** `matches`: non-blank title, non-blank team names, two *different* teams, a kick-off inside 2000–2100, and a `qrCodeUrl` that is either absent or non-blank. `live_scores`: an over of at most five balls (`…_balls_shape`, so `16.6` cannot be stored), non-negative runs with wickets at most 10, and a positive `version`. The service refuses all of these first; the constraints exist so that a hand-run statement during an incident cannot produce a scoreboard the application cannot read.
- **Precondition.** The migration counts rows that would break the new constraints and refuses to run if it finds any. Both local databases were clean.
- **`live_scores.version` and `created_at`.** `version` is the optimistic lock the score endpoint compares against (§6.2); `created_at` separates the first write of a board from every replacement of it, which an `updatedAt`-only table cannot express.

### 5.3 Relationships

```
users 1 ── 0..1 wallets
users 1 ── * payment_requests  * ── 0..1 admin_users (reviewedBy)
users 1 ── * withdrawal_requests * ── 0..1 admin_users (reviewedBy)
users 1 ── * transactions
users 1 ── * download_logs
matches 1 ── 0..1 live_scores * ── 0..1 admin_users (lastUpdatedBy)
admin_users 1 ── * admin_sessions
users 0..1 ── * users (referredBy, self-reference)
```

### 5.4 Invariants

Each invariant is marked by how it is enforced today.

1. A wallet's cached balances equal the sum of its ledger rows. *Enforced by the wallet service. Every change writes one ledger row under the wallet's row lock. Tested by comparing sums with cached balances. The nightly reconciliation job is not built yet.*
2. One UTR maps to one payment claim. *DB unique constraint (enforced).*
3. A payment or withdrawal leaves `PENDING` exactly once. *Enforced and tested for both queues. The reviewer locks the row with `SELECT … FOR UPDATE`, then runs `UPDATE … WHERE id = ? AND status = 'PENDING'` and requires exactly one row. Two admins approving one claim, or filing one payout from two tabs, produce one effect and a 409 for the other.*
4. Balances never go negative. *Enforced twice: CHECK constraints on `wallets` and `balance_after`, and the minimum rule in the service. Tested.*
5. Ledger rows are never updated or deleted. *Planned: DB grants. Not applied.*
6. Every admin write has an audit row. *Model not yet added.*
7. Predictions are accepted only while `now < match.startTime`, using the server clock. *Planned.*
8. A withdrawal leaves at least 100 winning tokens in the wallet (`MIN_RETAINED_WINNING_TOKENS`). *Enforced in `debitWinning` under the wallet lock. Tested, including 25 concurrent withdrawals.*
9. One UTR buys one credit, ever. *Enforced twice: the unique `payment_requests.utr_number` index, and the unique `(user_id, type, reference_id)` ledger index, where the reference is the payment id. Tested, including two reviewers approving the same claim at the same moment: one credit, one ledger row.*
10. `tokensToCredit` is never chosen by the member. *Enforced in `createPaymentRequest` (the server computes it from `amount` and `TOKENS_PER_RUPEE`) and by a strict body schema that rejects the field. Tested.*

11. A payout never pays more than the request took. *The tokens leave `winningBalance` when the request is filed, so an approval changes no balance and replaying it is a 409 rather than a second payment. A refusal calls `refundWinning`, which returns exactly what that request's own `WITHDRAWAL` ledger row removed, and only once. If the row and the debit disagree, the refund fails with 422 `REFUND_NOT_MATCHED` and the request stays PENDING. Tested, including a request whose `amount` was edited after filing.*
12. A payout request never exists without its debit. *`createWithdrawalRequest` creates the row and calls `debitWinning` inside one interactive transaction, so a minimum-balance failure rolls the claim back with it. Tested by asking for an amount that breaks the floor and then counting rows.*
13. A member's payout instructions are stored as they will be used. *`normalizeUpiId` trims, lower-cases, requires `local@handle`, allows letters/digits/`.`/`_`/`-` before the `@` and letters only after it, and caps each half. `adminUtr` goes through the same canonicalisation as an inbound UTR (`src/lib/bank-reference.ts`), so a reference typed twice with different spacing still matches the bank statement it came from.*

14. A fixture has two different sides, a real kick-off, and never a blank payment link. *The five `matches` CHECKs, mirrored in `src/lib/match.ts`. A QR is either a usable absolute URL on an allowed host or `NULL`: `""` and `"   "` are refused with 400, so retiring a payment link has to be said as `null` and cannot be the accidental result of an emptied form field. Tested at both layers, the DB layer with raw inserts the API would never let through.*
15. One scoreboard per match, and it only moves forward. *`live_scores.match_id` is unique, which is why "create the score" and "update the score" are one endpoint. `version` increments on every accepted write, and runs, wickets and overs may not go backwards: 409 `SCORE_REVERSAL`, because the usual cause of a decreasing board is a stale tab, not a correction. A SUPER_ADMIN may post anything, including into a `COMPLETED` match, so a genuine correction is never blocked. Tested.*
16. Two writers, one board, no lost update. *`upsertLiveScore` takes `SELECT … FOR UPDATE OF m` on the match row, reads the stored board, then writes, so two scorers cannot interleave. A caller that sends `expectedVersion` gets 409 `SCORE_STALE` with `details.currentVersion` rather than quietly overwriting someone's over. Tested with five writes against one fixture and live against the running server.*
17. A played fixture is a fact. *Once a match is not `UPCOMING`, or has a scoreboard, its title, both team names and its `startTime` need SUPER_ADMIN, and so does moving `status` backwards, because predictions and settlement will read those columns as history (409 `MATCH_LOCKED` names the role that can proceed). A save that changes nothing is not an edit: `changed: []` comes back and `updatedAt` does not move, so it cannot invalidate every cached copy of the match.*
18. Reading a score does not reveal who wrote it. *`lastUpdatedBy` — staff id and display name — is joined only on the admin projection. `GET /api/matches/:id/score` selects the relation away, and a test asserts the key is absent from the public view.*

### 5.5 Schema gaps and recommended changes

The fields were kept exactly as specified. The gaps below should be closed before any money use (P0) or before predictions launch (P1). P2 is needed before public launch.

| Pri | Gap | Recommendation |
|---|---|---|
| P0 | `transactions` has no status | Add `status` (PENDING / POSTED / REVERSED) so a ledger row can be provisional. *Still open, and no longer blocking: the payout flow holds funds by debiting them at request time and writing a `REFUND` row on a refusal (§6.5) instead of writing a PENDING ledger row. A status column is still wanted to reverse an already-approved payout and to hold a credit before approval.* |
| P0 | `transactions.amount` is unsigned and has no direction | **Done** (`add_wallet_ledger_guards`): signed `amount` and `balance_after`. |
| P0 | `balanceType` is free text | **Done**: enum `BalanceType { DEPOSIT, WINNING }`. |
| P0 | Money stored as `Int` in INR and tokens | Store paise as `BigInt`. `Int` tops out at 2,147,483,647, which is about ₹2.15 crore in paise, and sums can overflow. |
| P0 | `tokensToCredit` is supplied by the client | **Done**: `createPaymentRequest` computes `amount × TOKENS_PER_RUPEE`, and the body schema rejects the field, so a client cannot mint its own rate. A rate table per match or promo still does not exist; there is one constant. |
| P0 | `wallets` cascade on user delete | Change to RESTRICT. Anonymise users instead of hard-deleting them. |
| P0 | No CHECK constraints | **Done** for `wallets`, `transactions` (four CHECKs), `payment_requests` (positive `amount` and `tokens_to_credit`), `withdrawal_requests` (positive `amount`), `matches` (five) and `live_scores` (three), all raw SQL. |
| P0 | No indexes on FK columns | **Partly done**: `transactions` has `(user_id, created_at)` plus the unique `(user_id, type, reference_id)`; `payment_requests` and `withdrawal_requests` each have `(user_id, created_at)` and `(status, created_at)`. Postgres does not index FK columns automatically. |
| P0 | No audit trail for admin actions | Add `AdminAuditLog { id, adminId, action, entity, entityId, before Json?, after Json?, ipHash, createdAt }`. Until it exists, the one action in this area that deserves a line is logged: attaching, replacing or clearing a match's `qrCodeUrl` writes `console.info` with the admin id and the URL host, never the URL itself. |
| P1 | No prediction model | Add `Prediction { id, userId, matchId, pick, lockedAt, points Int?, settledAt, createdAt }` with `@@unique([userId, matchId])`. |
| P1 | Scores stored as display strings (`"182/4"`) | Integer `runs`, `wickets`, `balls`. **Partly done** (`add_match_management`): `version` exists and is checked, and the strings are parsed at the boundary so bounds are enforced and `16.6` can never be stored. The columns themselves are still `VarChar`, which is enough for a scoreboard poll and not enough for a ball-by-ball model. |
| P1 | No ball-level events | Add an append-only `BallEvent` table so scores can be replayed and corrections audited. One board per match with a `version` counter is what we have; it can tell you that version 9 replaced version 8, not what happened in between. |
| P1 | `MatchStatus` has no `CANCELED` or `ABANDONED`, and a fixture can never be retired | Decide the two together: either a status that stops predictions and unwinds open claims for that match, or a `hidden`/`isActive` flag. Neither was invented in the match change, because what should happen to a member's stake on an abandoned match is a prediction question (§15), and there is nothing to unwind yet. What exists instead is that a SUPER_ADMIN can move a status backwards, so a fixture created in error can be pushed back to `UPCOMING` and left unplayed. |
| P1 | `matches` has no external ID or status-time index | **Done** (`add_match_management`): `externalId String? @unique`, `(status, start_time)`, and `(start_time, id)` for the cursor. |
| P2 | No consent or deletion-request records (DPDP) | Add `ConsentRecord` and `DeletionRequest` before the site makes privacy promises. |

---

## 6. Key flows

### 6.1 Member sign-in (as built)

1. Google OIDC callback. NextAuth `signIn` calls `provisionUser` (`src/lib/user.ts`).
2. The lookup matches on `googleId` OR `email`. This is review H4: it rebinds `googleId`, and `email_verified` is not checked. Fix before linking admins or money.
3. The referral cookie `cpc_ref` is applied once. Self-referral is blocked.
4. A 30-day JWT session is issued. The DB resync runs every 24 h and clears the user ID if the account was deleted, so a deleted user can keep access for up to 24 h (review M4).

### 6.2 Match lifecycle and live scoring (as built)

1. **Create.** `POST /api/admin/matches` with `{ title, teamA, teamB, startTime, qrCodeUrl?, externalId? }`, open to SCORE_ADMIN and SUPER_ADMIN. The fixture lands in `UPCOMING`; `status` is not a create field, because a create that could set it would step around every transition rule below — the body schema is `strict()`, so an extra key is a 400 rather than a silently ignored one. Same two teams (in either order) at the same kick-off is 409 `DUPLICATE_MATCH`, and a feed's own id colliding with another fixture is the same code.
2. **Open.** `PATCH /api/admin/matches/:id { status: "LIVE" }` — the same endpoint used for every edit, returning the match plus `changed`. `LIVE` is only legal with a kick-off that is not in the future. Forward moves are a scorer's job; moving a status backwards, or touching the identity of a fixture that has been played, needs SUPER_ADMIN (§5.4.17).
3. **Score.** `POST /api/admin/matches/:id/score` with `{ teamAScore, teamBScore, currentOver, batsmanStats?, bowlerStats?, expectedVersion? }` creates or replaces the fixture's one `LiveScore` row, records `lastUpdatedById`, and increments `version`. `48` and `"48/1"` are both accepted — a bare number inherits the wickets already stored, so an operator typing only runs cannot erase a wicket. Overs canonicalise to `overs.balls` with balls 0–5. Batsman and bowler stats are bounded display blobs: an object (or at most two per side) of 1–12 scalar keys, 4 KB of JSON, nested values refused by name. The reply is `{ created, match, score, warnings }`, with a warning when a board is posted onto a fixture that is still `UPCOMING`, because it will not appear in the live list until its status moves.
4. **Read.** `GET /api/matches/:id/score`, `/api/matches/live`, `/api/matches`, `/api/matches/:id`, no session. A score response is `public, max-age=5, s-maxage=5, stale-while-revalidate=20, stale-if-error=300` with a weak `ETag` over `version | updatedAt | status`; a matching `If-None-Match` costs a 304 with no body. The read still happens first — one indexed query, no serialisation, no payload — which is the whole point of the tag on a ten-second poll. Lists are cached for 15 s, carry a page-level ETag that folds in every scoreboard version on the page, and page on `(startTime, id)` cursors with `order` echoed back so a client cannot mis-page. `q` exists only on the admin list.
5. **The payment link belongs to the fixture.** `GET /api/payment/qr` (§6.4) takes the newest `LIVE` match with a QR and falls back to the newest `UPCOMING` one, so opening a match in the console is also what starts deposits being attributable to it, and retiring the QR is what stops it. The URL itself leaves the application only there: no public match response carries `qrCodeUrl`.
6. **A feed, if it is ever wired.** A provider ingests through the same admin score endpoint with `externalId` and `expectedVersion`, so a poll of an upstream source can neither create a second copy of a fixture nor overwrite a human's correction. Nothing else changes, which is the reason the endpoint is shaped the way it is.
7. **Close.** `PATCH { status: "COMPLETED" }` freezes the board against everyone but a SUPER_ADMIN. Settlement is still unwritten — there is no prediction table — so today closing a match ends the scoreboard and nothing else.

### 6.3 Prediction submission (proposed)

- Requires sign-in. The server checks `now < startTime`. The write is an upsert keyed on `(userId, matchId)`. After lock, returns 409 `MATCH_LOCKED`.
- Rate-limited per user (Redis) and per IP.

### 6.4 Deposit claim: ONLY when `MONEY_MODE` is on and counsel has approved

1. The member uploads a screenshot through a presigned URL to a private bucket. Read access uses signed URLs that expire in 5 minutes or less. No public URLs.
2. A `POST` creates a `PaymentRequest` with status `PENDING`. A duplicate UTR returns 409.
3. PAYMENT_ADMIN approves in one DB transaction:
   - a conditional update from `PENDING` to `APPROVED`, requiring exactly one row;
   - insert a `Transaction` (DEPOSIT, POSTED);
   - increment the wallet's deposit balance under `SELECT … FOR UPDATE`;
   - write the audit row.
   Rejection moves `PENDING` to `REJECTED` and records a note.
4. Two-person approval above a threshold (proposed).

**As built (payment change).** The flow above is now the shipped flow, minus the presigned upload:

1. `GET /api/payment/qr` answers with the `qrCodeUrl` of the newest match that is still taking money: the latest `startTime` among `LIVE` matches, otherwise among `UPCOMING` ones. A row with a null or blank `qrCodeUrl` is skipped in SQL, so retiring a QR is a field clear, not a delete. Nothing eligible is 404 `NO_ACTIVE_QR`, which is how the client knows to hide the panel.
2. `POST /api/payment/request` with `{ amount, utrNumber, screenshotUrl }` creates one PENDING row and touches no balance. The server computes `tokensToCredit = amount × TOKENS_PER_RUPEE`; a body that sends the field is rejected. The UTR is trimmed, upper-cased, limited to `[A-Z0-9-]{8,32}`, and the unique index rejects a repeat (409). At most `MAX_PENDING_PER_MEMBER` claims may sit unreviewed per member.
3. `GET /api/admin/payments?status=PENDING` is the queue, keyset-paged like the ledger, with the member and reviewer attached and whole-queue counts for the tab labels.
4. Approve runs in one interactive transaction: `SELECT … FOR UPDATE` on the claim, a conditional `PENDING → APPROVED` that must match exactly one row, then `creditDeposit(…)`, which locks the wallet and writes the `DEPOSIT` ledger row. A failure at any step rolls the status change back too, so there is no such thing as an approved-but-uncredited claim, or a credit without the claim that justified it.
5. Reject sets REJECTED with a required note. No reversal is needed, because nothing was ever credited.

`creditDeposit(userId, amount, paymentId, description, { tx })` in `src/lib/wallet.ts` still owns the ledger side: the payment must be APPROVED, must belong to the member, and its `tokensToCredit` must equal the amount being credited.

**Still open:** a presigned private upload for the screenshot (today the client passes a URL it already has), a member-facing `GET /api/payment/requests` so a member can read their own claim states without scraping the ledger, the audit row for both reviews, and two-person approval above a threshold.

### 6.5 Withdrawal: ONLY when `MONEY_MODE` is on and counsel has approved

1. The member requests an amount no larger than the winning balance. In one transaction, create a `WithdrawalRequest` (PENDING) and a PENDING ledger row that holds the funds.
2. PAYMENT_ADMIN pays out outside the platform, records `adminUtr`, and sets APPROVED. The ledger row moves to POSTED.
3. Rejection moves the ledger row to REVERSED and releases the funds.
4. Withdrawals stop automatically if the reconciliation job reports a mismatch.

**As built (withdrawal change).** The hold is not a ledger status; it is the debit itself. The `PENDING` ledger row of step 1 was replaced by cutting the balance when the request is filed, because the ledger has no status column (§5.5) and a real hold is worth more than a flag on a row.

1. `POST /api/withdrawal/request` with `{ amount, upiId }`. In **one** interactive transaction: insert the `withdrawal_requests` row as PENDING, then `debitWinning(userId, amount, requestId, …, { tx })`, which locks the wallet with `SELECT … FOR UPDATE`, checks that `winningBalance − amount ≥ 100`, applies the debit and writes the `WITHDRAWAL` ledger row (negative, `balanceType = WINNING`, `referenceId` = the request id). Either both halves land or neither does, so an orphan claim that could later be "approved" into a payment cannot exist. Before the transaction: `MONEY_MODE`, the amount, the VPA shape, and `MAX_PENDING_PER_MEMBER` (429 past 5 waiting requests). A 201 carries the request, the new balances and the ledger entry, so a client can refresh the screen from one response.
2. Refusals at this step are ordinary: 400 for a non-whole amount or a VPA that is not `local@handle`, 422 `MINIMUM_BALANCE` with the exact copy "Minimum 100 tokens must remain in wallet" when the amount would break the floor *or exceeds the balance*, 404 `WALLET_NOT_FOUND`, 503 while the gate is off.
3. The member reads their own requests at `GET /api/withdrawal/my` (keyset-paged, `?status=` optional). The projection has no reviewer object and no user object — a reviewer's identity is not part of a payout receipt.
4. `GET /api/admin/withdrawals?status=PENDING` is the queue: request, member, `upiId`, `adminUtr`, reviewer, and `counts` for the whole filtered queue.
5. Approve (`POST /api/admin/withdrawals/:id/approve`) locks the row, requires PENDING, moves it to APPROVED with `reviewedById`, and stores `adminUtr` when the reviewer has one. **No balance moves** and no ledger row is written — the tokens already left. That is what makes a replayed approval harmless.
6. Refuse (`POST /api/admin/withdrawals/:id/reject`, `{ reviewNote }` required) locks the row, moves it to REJECTED with the note, and calls `refundWinning(userId, amount, requestId, …, { tx })` in the same transaction. The refund is guarded three ways: the `(user_id, type, reference_id)` unique index means one request can be refunded once; `refundWinning` looks up that request's own `WITHDRAWAL` row and returns **exactly** what it removed; and any mismatch throws 422 `REFUND_NOT_MATCHED`, which rolls the status change back so a human inherits a PENDING row rather than a discrepancy.

**Why the cut-at-request ordering.** The alternative — credit-on-approval — would let a member spend the same tokens twice: file two requests against one balance, then have both approved. Cutting at filing means the platform can never pay out more than it already holds, and a queue that waits overnight cannot drain a wallet. The price is that a refusal must refund, which is why that path carries its own guard.

**Still open:** two-person approval above a threshold; an automatic cap on what one admin may confirm in an hour; reversal of an already-approved payout (needs the ledger status in §5.5); the audit row for both actions; and a fee or minimum-payout policy, which is a product decision that the `MONEY_MODE` review should settle before launch.

### 6.6 Admin login and RBAC

- Built: `POST /api/admin/login`, `POST /api/admin/logout`, `GET /api/admin/me`, and the `requireAdmin(roles?)` guard (`src/lib/admin-guard.ts`).
- Passwords are bcrypt hashes (bcryptjs, cost 12). A wrong password, an unknown email and a deactivated account all get the same answer. Login requests must be `application/json`.
- The session is a signed JWT (jose, HS256) in an httpOnly, `SameSite=Strict` cookie. Each JWT points at an `admin_sessions` row, so logout and expiry are enforced on the server. Lifetime is 8 hours, with no sliding.
- Roles and `isActive` are read from the database on every request, so a change applies to the next request.
- Not built yet: TOTP (planned as mandatory for admins), a password change or reset flow, and the audit log for admin actions.
- Permission matrix (proposed):

| Action | SUPER_ADMIN | SCORE_ADMIN | PAYMENT_ADMIN | SUPPORT_ADMIN |
|---|---|---|---|---|
| Manage admin accounts | Yes | – | – | – |
| Create or edit matches, enter scores | Yes | Yes | – | – |
| Review payments and withdrawals | Yes | – | Yes | – |
| View members and ledgers (read-only) | Yes | – | Yes | Yes |
| Manual ledger adjustment (`ADMIN_ADJUST`) | Yes (two-person) | – | – | – |

- Deny by default. Every route has a test for each role.

### 6.7 APK download (as built, and target)

- **Target:** authenticate, rate-limit, write `download_logs` (including failed or 503 attempts), then return a short-lived signed URL. The page never links a CDN directly (review H2, H3, H7).

---

## 7. API surface (proposed v1)

**Conventions**

- JSON envelope: `{ ok: true, data }` on success and `{ ok: false, error, code, details }` on failure. This matches the existing routes.
- Zod validation on every route.
- An `Idempotency-Key` header on any money POST.
- Status codes: 401 unauthenticated, 403 wrong role, 404 not found, 409 conflict or locked, 422 validation error, 429 rate limited.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/v1/matches` | Public | Cached 60 s |
| GET | `/api/v1/matches/:id/score` | Public | `ETag`, `s-maxage=5` |
| POST | `/api/v1/matches/:id/predictions` | Member | 409 `MATCH_LOCKED` after `startTime` |
| GET | `/api/v1/leaderboard` | Public | Cached; per match or season |
| GET | `/api/v1/me` | Member | Profile and referral stats |
| POST | `/api/v1/admin/matches` | SCORE_ADMIN | Create |
| PATCH | `/api/v1/admin/matches/:id` | SCORE_ADMIN | Status transitions validated server-side |
| POST | `/api/v1/admin/matches/:id/score` | SCORE_ADMIN | `version` required |
| GET | `/api/v1/admin/payments?status=PENDING` | PAYMENT_ADMIN | Only when `MONEY_MODE` is on |
| POST | `/api/v1/admin/payments/:id/review` | PAYMENT_ADMIN | Only when `MONEY_MODE` is on |
| POST | `/api/v1/admin/withdrawals/:id/review` | PAYMENT_ADMIN | Only when `MONEY_MODE` is on |
| GET | `/api/v1/admin/audit` | SUPER_ADMIN | Read-only |

**Built wallet endpoints.** These use the paths requested for this change, without the `/v1` prefix used in the proposal above. Errors use the same envelope.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/wallet` | Member | `depositBalance`, `winningBalance`, `total`, `withdrawableBalance`. `Cache-Control: no-store`. |
| GET | `/api/wallet/transactions` | Member | Newest first, keyset-paged. `?limit=` 1–100 (default 20), `?cursor=`. Amounts are signed. |
| GET | `/api/admin/wallet/:userId` | SUPPORT_ADMIN, PAYMENT_ADMIN, SUPER_ADMIN | Read-only: profile, balances, first ledger page. Not audited yet. |
| GET | `/api/me` | Member | The snapshot a home screen needs in one call: `{ user, wallet, stats, warnings }`. `user` is a fixed seven-key profile — no `googleId`, no `referredById`. `wallet` is the same four numbers as `/api/wallet`, or `null` with the reason in `warnings` if the wallet row is missing. `no-store`. |

**`/api/me` and `/api/session` overlap on purpose.** `/api/session` stays the slim identity check NextAuth-adjacent clients already call (profile, referral code, two counters, no money), and both read the same row. `/api/me` is the one to use for anything that also shows a balance: one request instead of two, and it is the one that can tell you a wallet is missing instead of answering 404. Nothing writes in either.

**The member-facing reads and their gate.** `GET /api/me`, `/api/wallet` and `/api/wallet/transactions` require a member session (`requireMember()`, id taken from the signed JWT and never from a parameter) and answer `no-store`. `GET /api/matches`, `/api/matches/:id`, `/api/matches/:id/score` and `/api/matches/live` need no session, because a fixture calendar and a scoreboard are not personal data — the personal parts (payment QR, feed id, which staff account wrote a board) are excluded from those projections by construction, and `tests/me.test.ts` asserts both halves of that rule from the source tree, so a new route cannot be added to either list by accident.

**Built payment endpoints** (payment change). Same path style as the wallet change.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/payment/qr` | Member | QR of the newest LIVE match, else the newest UPCOMING one. 404 `NO_ACTIVE_QR` when neither has a URL. `Cache-Control: no-store`, because a stale QR sends money to the wrong account. |
| POST | `/api/payment/request` | Member | `{ amount, utrNumber, screenshotUrl }` → 201 and a PENDING claim. 400 validation, 409 `DUPLICATE_UTR`, 429 `TOO_MANY_PENDING` or the per-account throttle, 415 for a non-JSON body. |
| GET | `/api/admin/payments` | PAYMENT_ADMIN, SUPER_ADMIN | `?status=&limit=&cursor=&userId=`. Keyset-paged, newest first, plus `counts` for the whole queue. |
| POST | `/api/admin/payments/:id/approve` | PAYMENT_ADMIN, SUPER_ADMIN | Body `{}` or `{ reviewNote }`. One transaction: lock, conditional update, credit, ledger row. 409 on a replay. |
| POST | `/api/admin/payments/:id/reject` | PAYMENT_ADMIN, SUPER_ADMIN | Body `{ reviewNote }`, required. No wallet write. |

**Built withdrawal endpoints** (withdrawal change). Same path style, same envelope, same `requireAdmin(["SUPER_ADMIN","PAYMENT_ADMIN"])` role list.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/withdrawal/request` | Member | `{ amount, upiId }` → 201 with the request, the balances after the cut, and the `WITHDRAWAL` ledger row. 400 validation, 422 `MINIMUM_BALANCE`, 429 `TOO_MANY_PENDING` or the per-account throttle, 415 non-JSON, 503 gated. |
| GET | `/api/withdrawal/my` | Member | `?status=&limit=&cursor=`. Keyset-paged, newest first, no reviewer or user object. Not gated: a member can always read the state of a request they filed. |
| GET | `/api/admin/withdrawals` | PAYMENT_ADMIN, SUPER_ADMIN | `?status=&limit=&cursor=&userId=`. Whole-queue `counts`, and no admin secrets in the projection. Not gated, so the queue can be read while the feature is dark. |
| POST | `/api/admin/withdrawals/:id/approve` | PAYMENT_ADMIN, SUPER_ADMIN | Body `{}` or `{ adminUtr }`. Marks the payout sent; **moves no balance**. 404 unknown id, 409 already reviewed, 503 gated. |
| POST | `/api/admin/withdrawals/:id/reject` | PAYMENT_ADMIN, SUPER_ADMIN | Body `{ reviewNote }`, required. Refunds exactly the amount in the same transaction. 409 already reviewed, 422 `REFUND_NOT_MATCHED`, 503 gated. |

**Built match endpoints** (match change). Same path style, no `/v1` prefix, and `SUPER_ADMIN` is listed everywhere rather than being an implicit pass inside `requireAdmin`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/matches` | none | Public fixture list: upcoming, live and completed. `?status=&from=&to=&order=&limit=&cursor=`. Each row carries a score summary, so a list is not N+1 reads. 15 s cache and a page ETag. No `q`. |
| GET | `/api/matches/:id` | none | One fixture, the same shape as a list row. 304 on a matching `If-None-Match`. `qrCodeUrl` is never here: it is a payment destination. |
| GET | `/api/matches/:id/score` | none | `{ match, score }`, `score` null before the first write, so "no runs yet" is distinguishable from "no such match". 5 s cache, weak ETag over `version \| updatedAt \| status`, 304 with no body. |
| GET | `/api/matches/live` | none | What is being played, freshest action first, unscored matches included with `score: null`. Unpaged by design; `?limit=` bounds it, `GET /api/matches?status=LIVE` is the paged form. |
| GET | `/api/admin/matches` | SUPER_ADMIN, SCORE_ADMIN | The console list: every public field plus `qrCodeUrl`, `externalId`, `hasQrCode`, `score.lastUpdatedById`, and `counts` for the status tabs of the whole filtered set. `?q=` searches title and both team names — an unindexed `LIKE`, which is why it is admin-only. `no-store`. |
| POST | `/api/admin/matches` | SUPER_ADMIN, SCORE_ADMIN | `{ title, teamA, teamB, startTime, qrCodeUrl?, externalId? }` → 201 and the match. 400 on a field, on one-sided teams, or on any `status` key; 409 `DUPLICATE_MATCH`. |
| PATCH | `/api/admin/matches/:id` | SUPER_ADMIN, SCORE_ADMIN | Any subset of those fields plus `status`. Returns the match and `changed`. 400 on an empty patch, 404, 409 `MATCH_LOCKED` (needs SUPER_ADMIN) or `DUPLICATE_MATCH`. `qrCodeUrl: null` retires the payment link; `""` is refused instead. |
| POST | `/api/admin/matches/:id/score` | SUPER_ADMIN, SCORE_ADMIN | Create-or-replace the board → 201 the first time, 200 after, and `{ created, match, score, warnings }`. 400, 404, 409 `SCORE_STALE` / `SCORE_REVERSAL` / `MATCH_LOCKED`. |
| — | `DELETE /api/admin/matches/:id` | — | **Deliberately absent**, along with a single-match admin read (405). Fixtures are not thrown away, and `GET /api/admin/matches?limit=1` already answers "what did I just save". |

**Does any endpoint move money?** Three do. `POST /api/admin/payments/:id/approve` credits `depositBalance`; `POST /api/withdrawal/request` debits `winningBalance`; `POST /api/admin/withdrawals/:id/reject` credits it back. All three are reachable only while `MONEY_MODE` allows it (§13), and the two member-facing writes that feed them (filing a claim, filing a payout request) are gated identically. So a production deploy with the flag unset exposes no funnel at all: nothing can be paid in, nothing can be credited, and nothing can be asked out. The reads — both queues and the member's own history — are deliberately not gated, because a request whose tokens are already held is exactly the thing someone must be able to look at while the feature is dark. None of the eight match routes is in that list of three, including the score write: a scoreboard changes no balance, and a fixture has to be creatable and scoreable while the money features are off, otherwise the platform cannot run its free-to-play side during the legal review. `GET /api/payment/qr`, which is gated, reads the same `qrCodeUrl` these routes write, so switching the flag on is the only step between "fixture exists" and "members can pay into it". Manual ledger adjustment still has no endpoint; `ADMIN_ADJUST` is called only from server code.

---

## 8. Security and privacy

- **Member auth:** Google OIDC only, as built. Check `email_verified` before linking accounts (H4).
- **Admin auth:** separate from members. Bcrypt password now. TOTP is planned but not built. Admins never sign in with Google.
- **Authorization:** deny by default in middleware, plus a check in every handler. Each admin route checks `roles`, with tests per role.
- **Input:** zod on every route (the referral routes already do this). Reject unknown fields. Cap body size.
- **Rate limits:** replace the per-process Map (review M13) with Redis. Key by user ID when authenticated. Use an IP key only when the platform sets a trusted header (see the caveats in review M13). Add limits to `/api/download` (H7) and `/api/referral/capture` (M12).
- **Claim flooding:** `POST /api/payment/request` is throttled per member in memory (10 per hour) and, more importantly, by `MAX_PENDING_PER_MEMBER` counted in the database, so a flood cannot grow the review queue without bound even on a cold instance.
- **Forced posts:** every state-changing, cookie-authenticated POST in the money area requires `application/json` (`readJsonBody` in `src/lib/http.ts`), the same defence used on admin login. A cross-site HTML form cannot set that content type without a preflight, so a member's browser cannot be pointed at `/api/payment/request`, nor an admin's at `/approve`, by another site.
- **Untrusted proof links:** `screenshotUrl` is parsed as a URL and must be http(s) with no embedded credentials, and hosts that resolve to loopback, private, link-local or cloud-metadata ranges are refused. The value is later rendered inside an admin's browser, so this is a real path to leaking an internal service. It is not a substitute for storing proofs in private storage behind signed URLs.
- **Headers:** HSTS, X-Frame-Options, nosniff, Referrer-Policy, and Permissions-Policy are already set. Add a Content-Security-Policy (M14).
- **Sensitive data:** UTRs, UPI IDs, and payment screenshots are financial personal data. Store them privately, use signed read URLs, log access, and set a retention policy. IP addresses stay hashed (existing `ipHash`).
- **Secrets:** environment variables only. `.env` is gitignored (verified). Generate `NEXTAUTH_SECRET` separately for each environment and never reuse example values.
- **Audit:** every admin write (see P0 in §5.5).
- **DPDP Act 2023:** notice, consent, grievance contact, and an erasure path. The privacy page currently promises features that are not implemented (review C5).

---

## 9. Reliability, consistency, and concurrency

- Money and scoring writes run inside Prisma interactive transactions. Lock wallet rows with `SELECT … FOR UPDATE`. Use conditional updates for every state transition. *Wallet writes do this (`src/lib/wallet.ts`), and so do payment reviews: the claim is locked with `SELECT … FOR UPDATE` and `PENDING → APPROVED` is a conditional update that must match exactly one row (`src/lib/payment.ts`). Tested by approving the same claim from two admins at once: exactly one credit, one ledger row, and the loser gets 409. Withdrawal reviews are still unwritten, so no rule applies yet.*
- **Idempotency:** rely on natural keys first (UTR unique, prediction unique per user and match, score `version`). Add an `Idempotency-Key` table only for operations without a natural key.
- **Reconciliation job:** runs nightly and on demand. Compares wallet caches with ledger sums. On mismatch, it alerts and freezes withdrawals.
- **Backups:** Neon point-in-time restore. Test a restore before launch and then quarterly.
- **Migrations:** expand, backfill, then contract. Never combine a destructive change with the code that needs it in the same deploy. `vercel-build` runs `migrate deploy`, so a failed migration blocks the build. `add_wallet_ledger_guards` backfills wallets and stops if `transactions` already has rows (§5.2a).

**Failure modes**

| Dependency down | Behaviour |
|---|---|
| PostgreSQL | 503, with the health check failing. Transactions prevent partial writes. |
| Redis | Reads fail open to an in-process fallback. Money and admin writes fail closed. |
| Score provider | Score page shows a "last updated at" banner. Never fabricate values. |
| Object storage | Uploads are blocked. Existing claims remain reviewable. |

---

## 10. Scalability and performance

- **Load assumptions (unconfirmed, please supply):** peak concurrent members during a live match, prediction burst in the 15 minutes before lock, and admin headcount.
- **Hot paths:**
  - Live score reads: cache at the CDN and in Redis, so the database is read at most once per 5 s per match.
  - Leaderboard: materialised per match and recomputed on settlement.
  - Prediction burst: the unique constraint keeps writes idempotent, and the per-user rate limit caps abuse.
- **Connection pooling:** use Neon's pooled connection string for serverless functions, and set Prisma's `connection_limit`.
- **Indexes:** `payment_requests(status, created_at)` and `payment_requests(user_id, created_at)` are built (`harden_payment_requests`), which is what the review queue and the pending-count check use. Still to add when those paths appear: `matches(status, start_time)`, `predictions(match_id)`, and `withdrawal_requests(status, created_at)`. The rest of §5.5's P0 list stays open.

---

## 11. Observability

- Structured logs with a request ID. Use hashed user IDs. No PII in logs.
- Metrics: prediction p95 latency; score age (time from update to client visibility); review-queue age (oldest `PENDING`); reconciliation mismatches; 5xx and 429 rates.
- Alerts: review backlog over 2 h during match hours; any reconciliation mismatch; a spike in database errors.

---

## 12. Testing strategy

- **Existing:** Vitest unit suites, DB-backed provisioning tests, and HTTP contract tests (these need a running server).
- **Wallet (added):** 36 DB-backed tests (`tests/wallet.test.ts`) cover the rules, the exact minimum message, duplicate references, history paging, ledger-to-balance reconciliation, a 25-way concurrent withdrawal race, caller-transaction rollback, and a rolled-back user when the wallet insert fails. 17 pure tests cover the HTTP helpers (`tests/wallet-http.test.ts`).
- **Payment (added):** 40 DB-backed tests (`tests/payment.test.ts`) cover claim creation and its validations, UTR normalisation and reuse across members, the pending cap, the QR preference order and the blank-QR skip, approve (balance, ledger row, reviewer, partial approval), a replayed approval, two admins approving at once, rejection with and without a note, the rollback that keeps a claim approvable when the member has no wallet, and the queue's filter, paging and counts. 39 pure tests (`tests/payment-http.test.ts`) cover the `MONEY_MODE` resolution table, the error envelope for both domain error classes, the content-type guard, and both body schemas.
- **Withdrawal (added):** 38 tests, 21 of them DB-backed (`tests/withdrawal.test.ts`) and 17 pure (`tests/withdrawal-http.test.ts`). The DB set covers the exact copy and the 100-token floor (including a request that lands on the floor and then cannot take one more token), a rollback that leaves no orphan request and no ledger row, a member with no wallet, two requests filed at once against one balance, the pending cap and the slot freed by a review, approve writing no ledger row and moving no token, a replayed approve, a reject that refunds exactly the amount with both ledger rows netting to zero, a second reject that cannot refund twice, a refusal after approval, an amount edited after filing (422 `REFUND_NOT_MATCHED`, the request left PENDING, nothing minted), and a final check that the winning balance still equals the sum of its ledger rows after every path. The pure set covers VPA acceptance and rejection, the shared reference rules, the note bounds, every error code's status, the wallet errors passing through, and the three body schemas refusing server-owned fields.
- **Matches (added):** 34 tests (`tests/match.test.ts`), DB-backed where the rule lives in the database, plus 37 pure HTTP-layer tests (`tests/match-http.test.ts`). The service set covers each normaliser's bounds (title, teams, kick-off, QR, external id, `"runs/wickets"`, `overs.balls`, the stats object's size and shape), create and both duplicate paths, every transition rule including the played-fixture lock and a status moving backwards, a no-op patch leaving `updatedAt` alone, monotonic score writes, `expectedVersion` conflicts, who wrote the board and who may not see that, the four public read shapes with their exact key sets, cursor paging in both directions, cascade delete, and that the eight new CHECKs actually fire — asserted with raw inserts, since the API refuses the same rows long before the database sees them. The pure set covers the error-code-to-status table, every query parameter's refusal (including a date-only `to` widening to the end of that UTC day, and an empty `q` being removed rather than matching everything), the three body schemas and their strictness, the actor's escalation flag, and the ETag and `Cache-Control` arithmetic. `tests/http-contract.test.ts` grew 11 checks that run against a live server: the public list is cacheable and never carries the QR or the feed id, `/api/matches/live` revalidates to a 304 with an empty body, anonymous callers get 401 on all four admin routes with `no-store` on the list, and `GET`/`PUT`/`DELETE` on the single-match admin route get 405. One consequence worth knowing: the four `getActivePaymentQr` selection tests in `tests/payment.test.ts` skip in a full-suite run when the match suite's rows are already in `matches` at collection time, and pass standalone (40/40) — the guard comment in that file says why.
- **Member snapshot (added):** 9 tests (`tests/me.test.ts`). Five need PostgreSQL: the profile's exact key set and the absence of `googleId`, `referredById` and anything password-shaped; balances carried through with `withdrawableBalance` already reduced by the retained minimum; referral and download counters; a member with no wallet row answering `wallet: null` plus one warning rather than zeros; and `null` for an account that is gone. The other four need no database and always run: they walk `src/app/api/**/route.ts` and assert that every route which is neither on an explicit public allow-list nor under `/api/admin` calls `requireMember()` or reads the session itself, that admin routes call `requireAdmin()`, that the four public match reads contain no member guard at all and say `No sign-in.` in their own doc comment, and that `/api/me` has a guard. That is the part of "protected where needed" that a live test cannot prove, because a live test only shows what the routes did today. 3 checks were added to `tests/http-contract.test.ts` (72 in that file now): 401 with `no-store` and no balance-shaped word in the body for a guest, 405 for a POST to `/api/me`, and a table over the six member-facing reads asserting 401 for the three personal ones and 200 for the three calendar ones.
- **Admin panel (added):** 16 tests in `tests/admin-web.test.ts`, none of which need a database beyond a mocked cookie jar. Four walk `src/app/admin/**`: every page but the sign-in screen must live under `(panel)`, the panel layout must actually call `requireAdminPage()`, no page may read `cookies()` itself (only the layout is allowed to, so a stale session cannot be half-handled), and a page that redirects to `/admin/login` by hand must also read the session — a bare redirect is a door painted on a wall. Five assert the section registry against the file tree in both directions (`built: true` and a page on disk, or the nav offers a 404; a page with no nav entry is an orphan nobody finds). The rest cover the role helpers: an empty allow-list means "any admin" and never "no admin", `SUPER_ADMIN` gains nothing implicitly because every list spells it out, and every value of the `Role` enum has a label so a badge cannot print blank. Three guard the page-side decisions themselves: a missing cookie and a cookie that will not verify both read as "signed out", and only that case redirects (asserted on Next's redirect digest), because bouncing a wrong-role admin off a page they can reach would loop.
- **To add:**
  - Schema invariant tests. Port the 14 behavioural checks run in this change into Vitest.
  - A member-facing claim list test, once that endpoint exists (the payout list already has one).
  - A payout under load: N members withdrawing at once against a shared prize pool, which the 2-way race in `tests/withdrawal.test.ts` does not cover.
  - RBAC matrix test for every admin route. The panel half of it is now covered for the two pages that exist (`sectionsFor` plus the wrong-role notice asserted live against `next start`); the API half is still a hand-written list in each route.
  - A Playwright pass over `/admin`: the review dialog's happy path and its 403/503 refusals, since those live in client code that no unit test reaches today.
  - Prediction lock tests with an injected clock.
  - Ball-level ingestion: a provider feed posting with `externalId` and `expectedVersion` under a retry, once a feed exists.
  - End-to-end smoke test with Playwright (none exists today).
- **CI:** none exists (no `.github/`). Add a pipeline that runs typecheck, lint, tests, `prisma validate`, and `prisma migrate diff --exit-code` (the drift check).
- **Load tests:** k6 against the score endpoint and a prediction burst, before launch.

---

## 13. Deployment and configuration

| Environment | Where | Database |
|---|---|---|
| Local | Developer machine (Postgres 17) | `cricket_platform` and `cricket_platform_shadow` |
| Preview | Vercel preview deployment | Neon branch per preview |
| Production | Vercel | Neon main branch |

**New configuration** (names only; values live in the host's secret store)

- `MONEY_MODE` (built, `src/lib/feature-flags.ts`). Gates both money funnels: filing a deposit claim and reviewing one, and filing a payout request and reviewing one (`src/lib/withdrawal.ts` calls the same `moneyModeEnabled()` through `requireMoneyMode()`). `true`, `1`, `on`, `yes` or `enabled` is on; `false`, `0`, `off`, `no`, `disabled` or an empty value is off; unset or unrecognised is **on outside production and off in production**, so a fresh production deploy exposes nothing until someone sets the value deliberately. Read per request, server-side only, never `NEXT_PUBLIC_`.
- `PAYMENT_RATE_TABLE`, not built. Today `TOKENS_PER_RUPEE` is one constant in `src/lib/payment.ts`. A per-match or promotional rate needs a table and a decision log, because two claims filed on the same day could otherwise credit different amounts.
- `PREDICTIONS_ENABLED`. Gates the prediction routes.
- `ADMIN_SESSION_SECRET` (built). `ADMIN_TOTP_ISSUER` when TOTP lands. `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `ADMIN_NAME` are read once by `npm run admin:create-super`.
- `REDIS_URL`, optional until rate limiting moves to Redis.
- `PRIVATE_STORAGE_BUCKET` and its credentials, for proof images and APK builds.
- `SCORE_PROVIDER_API_KEY`, only if a provider is chosen.

---

## 14. Roadmap

**Phase 0: before any public launch (blocking)**

- Record the counsel opinion and decide the product path (§2, §15).
- Fix claims and the fake verification effects (C1–C3). Implement or remove the privacy promises (C5).
- Fix the download path (H1–H3), login linking (H4), share link (H5), canonical URL (H6), and rate limits (H7, M13).

**Phase 1: admin foundation**

- Admin auth: TOTP is still to do, as is `AdminAuditLog`, and there is still no CI pipeline. **Built by the panel change:** `/admin` with a sign-in screen, a dashboard and the deposit-claim queue on the existing design system, role-filtered nav, and reviews that call the guarded API instead of moving money themselves. Deliberately not built yet: the payout console, the fixture console, the score form and the QR picker (their APIs are in place and guarded today), file upload for a QR image (there is still no upload endpoint, so `/admin/qr` will set `qrCodeUrl` by URL), and any session hardening beyond the 8-hour cookie. **Built by the match change:** match CRUD (create, patch, admin list with search and counts), the score-entry API with an author and optimistic versioning, and the public fixture and scoreboard endpoints with ETag caching and 304 revalidation. Deliberately still absent: deleting a fixture and `CANCELED`/`ABANDONED` statuses (§5.5), because what should happen to a prediction on an abandoned match is not decided yet.

**Phase 2: predictions and leaderboard (free-to-play)**

- Prediction model and lock rules. Settlement job. Leaderboard. The P1 schema changes.

**Phase 3: money (only if counsel approves a model)**

- Wallet service and ledger guards are built. The deposit path is built end to end (QR, claim, queue, approve, reject) and the payout path is built end to end (request with a cut at filing, member history, queue, approve, reject with a guarded refund), all behind `MONEY_MODE`. Those five writes are the only money-moving routes in the product. Still open: the ledger status column, which is what a reversal of an *approved* payout needs; reconciliation; KYC and tax design (a payout above the threshold should not be confirmable without a verified name); the presigned proof upload; two-person approval above a threshold; and `AdminAuditLog` for all four review actions. Check whether a payment gateway or bank will accept the flow.

---

## 15. Open decisions

1. **Product path:** free-to-play predictions only, paid contests (high legal risk), or wait for counsel?
2. **Money tables:** keep them dormant, or drop them in a follow-up migration if free-to-play is chosen?
3. **Score source:** manual admin entry, or a paid data provider (licensing to be checked)?
4. **Admin login:** email, password, and TOTP, or Google Workspace SSO with an allowlist?
5. **Hosting:** stay on Vercel and Neon, and add Redis (e.g. Upstash) for rate limiting?
6. **Load targets:** peak concurrent members and prediction-burst size.
7. **If money is approved:** paise or rupees, token exchange rate, withdrawal limits, and fund holds.
8. **User deletion policy:** anonymise (recommended) or hard delete.
9. **Prediction types and scoring rules:** match winner only, or also top scorer and other picks.

---

## Appendix A: Verification log (this change)

| Check | Command or method | Result |
|---|---|---|
| Install | `npm ci` | 525 packages. Prisma client v6.19.3 generated. |
| Database | PostgreSQL 17.11 from apt. Databases `cricket_platform` and `cricket_platform_shadow`. | Running locally on port 5432. |
| Baseline | `prisma migrate deploy` (init migration only), then drift check | Applied. No drift. |
| Schema | `prisma validate` | Valid. |
| Migration | `prisma migrate dev --name add_admin_wallet_match_ledger` | `20261009114731_add_admin_wallet_match_ledger` created and applied. |
| Status | `prisma migrate status` | Database schema up to date. |
| Drift | `prisma migrate diff --exit-code` | Exit 0. |
| Typecheck | `tsc --noEmit` | Exit 0. |
| Behaviour | 14 checks: defaults, uniqueness, RESTRICT, SET NULL, CASCADE | 14 of 14 pass. Cleanup verified. Script saved outside the repo at `/home/user/verification/schema_behaviour_smoke_test.cjs`. |
| Unit and DB tests | `vitest run` | 71 pass, 47 skip. The 39 HTTP tests need a server and the 8 artifact tests need a staged APK. |
| Provisioning DB tests | `vitest run tests/provisioning.test.ts` | Pass. |
| HTTP contract | `vitest run tests/http-contract.test.ts` against `next dev` | 39 of 39 pass across two runs. The sandbox's 2 GB RAM caused the dev server to restart between runs. |

**Not verified in this sandbox:** the Vercel build, Neon-specific behaviour, real Google OAuth, end-to-end APK download, load behaviour, and lint.

## Appendix B: Verification log (admin authentication)

| Check | Command or method | Result |
|---|---|---|
| Migration | `prisma migrate dev --name add_admin_sessions` | `20261009124708_add_admin_sessions` created and applied. It adds `admin_sessions` and nothing else. |
| Typecheck | `tsc --noEmit` | Exit 0. |
| Lint | `next lint` on `src`, `scripts`, `tests` | Exit 0. Only pre-existing warnings in `tests/referral.test.ts`. |
| Production build | `next build` | Exit 0. All three admin routes are dynamic (`ƒ`). |
| Admin unit and DB tests | `vitest run tests/admin-auth.test.ts tests/admin-bootstrap.test.ts` (test database) | 40 of 40 pass. |
| Full suite | `vitest run` (test database) | 111 pass, 50 skip. The 42 HTTP contract tests need a running server, and 8 artifact tests need a staged APK. |
| HTTP contract suite | `TEST_BASE_URL=... vitest run tests/http-contract.test.ts` against `next start` | 42 of 42 pass. |
| Route guard coverage | Temporary admin route without `requireAdmin()` | The coverage test fails on it, as intended. The probe route was then removed. |
| Seed script | `npm run admin:create-super` | Missing env: lists the errors and exits 1. First run: creates one SUPER_ADMIN. Second run: changes nothing and exits 0. The stored password is a bcrypt hash, and the plaintext is not in the row. |
| Live dev flow (curl) | Login, `/me`, logout, replay of the old token, GET on login, malformed JSON | 200, 200 with roles, 200 with cookie cleared, 401, 405, 400. Cookie is `HttpOnly; SameSite=strict; Path=/`. |
| Live production flow (curl) | Same flow under `next start` | Cookie is `__Host-cpc_admin_session` with `Secure; HttpOnly; SameSite=strict; Path=/`. Logout clears it with the same attributes. Replay returns 401. |
| Google sign-in regression | `/api/auth/providers`, `/api/auth/csrf`, `/api/auth/session`, `/dashboard` redirect, `/api/download` guard | Unchanged. |

**Known gaps at this point:** TOTP is not built, and the design calls for it as mandatory. Login and logout are not written to an audit log, because `AdminAuditLog` does not exist yet. There is no password change or reset flow. Admin pages (`/admin/*`) are not gated by middleware, so each page must call `requireAdmin()` itself. The rate limiter is per process and is a stopgap until Redis is in place.

## Appendix C: Verification log (wallet ledger)

| Check | Method | Result |
|---|---|---|
| Migration applied | `prisma migrate deploy` on `cricket_platform` and `cricket_platform_test` | Applied to both. |
| Schema drift | `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code` | Exit 0, "No difference detected". |
| Backfill and existing data | Scratch database at the previous schema with two users. One had a wallet holding 7 deposit and 3 winning tokens. Then the migration ran. | Two wallets. The existing wallet kept 7 and 3. The new wallet is 0 and 0. |
| CHECK and enum guards | Five invalid single-statement writes: zero amount, negative `balance_after`, negative winning balance, negative deposit balance, unknown `BalanceType` | All five rejected. |
| Unique reference guard | The same `(user, type, reference)` twice, and two rows with a NULL reference | The duplicate is rejected. NULL references may repeat. |
| Precondition | Migration run on a database that has one ledger row | Stops with "transactions is not empty…". Nothing changed. |
| Nested-write atomicity | Temporary trigger on the test database fails the wallet insert. Removed afterwards. | Prisma sent `BEGIN`, `INSERT users`, `INSERT wallets`, `ROLLBACK`. No user row was left behind. |
| Typecheck | `tsc --noEmit` | Exit 0. |
| Lint | `next lint` | Exit 0, no warnings. |
| Wallet DB tests | `vitest run tests/wallet.test.ts` (test database) | 36 of 36 pass. |
| Pure HTTP tests | `vitest run tests/wallet-http.test.ts` | 17 of 17 pass. |
| Full suite | `vitest run` (test database, no server) | 164 pass, 53 skip. Includes the admin route-coverage test and the provisioning tests. |
| Production build | `next build` | Exit 0. `/api/wallet`, `/api/wallet/transactions`, and `/api/admin/wallet/[userId]` are dynamic (ƒ). |
| HTTP contract | `TEST_BASE_URL=http://localhost:3000 vitest run tests/http-contract.test.ts` against `next start` | 45 of 45 pass. Includes the three new anonymous checks and the Google auth endpoints. |
| Live member and admin flow | Production server on the test database. A session cookie was minted from `NEXTAUTH_SECRET` for a test member. | 18 of 18 pass. Anonymous 401. Tampered session 401. Balances 500 deposit, 290 winning, 790 total, 190 withdrawable. History newest first with signed amounts, paged by cursor. 400 for `limit=0`, `limit=101`, and a malformed cursor. Admin: 401 without a cookie, 403 for SCORE_ADMIN, 200 for SUPER_ADMIN with no password hash in the body, 404 for an unknown member, 400 for a bad `limit`. |
| Cleanup | Live rows removed from the test database. Temporary fixture script deleted. | All table counts back to 0. |

**Not verified in this sandbox:** Google OAuth sign-in end to end, because the provider flow needs real Google credentials. Wallet creation on sign-in is covered by the `provisionUser` tests and the atomicity check above. Also not verified: Neon-specific behaviour, load beyond 25 concurrent debits, and the Vercel build.

---

## Appendix D: Verification log (payment request system)

| Check | Method | Result |
|---|---|---|
| Migration applied | `prisma migrate deploy` on `cricket_platform` and `cricket_platform_test` | Applied to both. Indexes and both CHECKs confirmed with `\d payment_requests`. |
| Schema drift | `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url … --exit-code` | Exit 0, "No difference detected". |
| Schema validity | `prisma validate`, `prisma format --check` | Valid, formatted. |
| Typecheck | `tsc --noEmit` | Exit 0. |
| Lint | `next lint` | Exit 0, no warnings. |
| Payment DB tests | `vitest run tests/payment.test.ts` (test database) | 40 of 40 pass. |
| Payment HTTP tests | `vitest run tests/payment-http.test.ts` | 39 of 39 pass. |
| Full suite | `vitest run` (test database, no server) | 243 pass, 59 skip across 12 files. Includes the admin route-coverage test, which now also scans the two new admin payment routes. |
| Production build | `next build` | Exit 0. `/api/payment/qr`, `/api/payment/request`, `/api/admin/payments`, and both review routes are dynamic (ƒ). |
| HTTP contract | `TEST_BASE_URL=http://localhost:3000 vitest run tests/http-contract.test.ts` against `next start` | 51 of 51 pass. Six new checks: 401 on every payment route for an anonymous caller, and 405 when a GET reaches a POST-only review action. |
| Live flow, gate on | `next start` on the test database with `MONEY_MODE=true`. A member session JWT was minted from `NEXTAUTH_SECRET`; three admins were seeded (PAYMENT_ADMIN, SCORE_ADMIN, SUPER_ADMIN) and signed in over HTTP. | 35 of 35 pass. QR resolves to the LIVE match's URL. A claim is created as PENDING with `tokensToCredit` equal to the rupees. A pending claim credits nothing. The same UTR twice is 409. A `tokensToCredit` in the body is 400. `javascript:` and loopback proof links are 400. A `text/plain` form post is 415. Approval returns 200 with `depositBalance` 450, `winningBalance` 0, and one `DEPOSIT` ledger row; the member's wallet and ledger then show it. A replayed approve is 409 and a reject after an approve is 409, with the balance unchanged. SCORE_ADMIN is 403 on the queue and on both actions; SUPER_ADMIN may reject. A member session on an admin route is 401. |
| Live flow, gate closed | Same server restarted with `MONEY_MODE` unset, which is production's default. | 5 of 5 pass. QR, claim filing and approve answer 503 `PAYMENTS_DISABLED`; admin sign-in still works and the queue is still readable. |
| Cleanup | Fixture users, wallets, claims, ledger rows, matches and admins removed from both databases. Temporary seed and check scripts kept outside the repo. | All table counts back to 0. |

**Not verified in this sandbox:** a real UPI payment, so the UTR checks were run against synthetic references only; the presigned upload path, which does not exist yet; and Google sign-in end to end, as before. `MAX_PENDING_PER_MEMBER` and the in-process throttle were exercised at the service level, not under load.

## Appendix E: Verification log (withdrawal system)

| Check | Method | Result |
|---|---|---|
| Migration applied | `prisma migrate deploy` on `cricket_platform` and `cricket_platform_test` | Applied to both. `\d withdrawal_requests` shows `withdrawal_requests_user_id_created_at_idx`, `withdrawal_requests_status_created_at_idx` and the `withdrawal_requests_amount_positive` CHECK. |
| Schema drift | `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url … --exit-code` | Exit 0, "No difference detected". |
| Schema validity | `prisma validate`, `prisma format --check` | Valid, formatted. |
| Typecheck | `tsc --noEmit` | Exit 0. |
| Lint | `next lint` | Exit 0, no warnings. |
| Withdrawal DB tests | `vitest run tests/withdrawal.test.ts` (test database) | 38 of 38 pass. |
| Withdrawal HTTP tests | `vitest run tests/withdrawal-http.test.ts` | 56 of 56 pass. |
| Full suite | `vitest run` (test database, no server) | 337 pass, 66 skip across 14 files. The admin route-coverage test now also scans `/api/admin/withdrawals` and both review routes, and the payment and wallet suites still pass, which is the regression check for the shared modules (`http.ts`, `pagination.ts`, `bank-reference.ts`, `review-note.ts`) this change extracted. |
| Production build | `next build` | Exit 0. All five withdrawal routes are dynamic (ƒ), as are the payment and wallet routes. |
| HTTP contract | `vitest run tests/http-contract.test.ts` against `next start` | 58 of 58 pass. Seven new checks: 401 with `no-store` on `/api/withdrawal/my` and `/api/admin/withdrawals` (query strings are not even parsed for an anonymous caller), 401 before the payout body is read on `/api/withdrawal/request`, 401 on both admin actions, and 405 when a GET reaches either POST-only route. |
| Live flow, gate on | `next start` on the test database with `MONEY_MODE=true`. A member session JWT was minted from `NEXTAUTH_SECRET`; three admins (PAYMENT_ADMIN, SCORE_ADMIN, SUPER_ADMIN) signed in over HTTP; the member's wallet started at 5000 winning tokens with the ledger row that justifies it. | 45 of 45 pass. A request that would leave 50 tokens is 422 with the exact copy; so is one larger than the balance, and neither leaves a row or a ledger entry. A valid request returns 201 with `winningBalance` 3800, the VPA lower-cased on the row, and one `WITHDRAWAL` ledger row of −1200 with `balance_after` 3800; the deposit balance is untouched. A body carrying `status` is 400. `text/plain` is 415. SCORE_ADMIN is 403 on the queue and on both actions. Approve stores `PAYOUT-2026-0001` from `" payout-2026-0001 "`, changes no balance and writes no ledger row; a replay is 409 and does not overwrite the reference; rejecting an approved payout is 409. Reject requires a note of at least a word, refunds exactly 700 once (the two rows net to zero), and a second reject is 409 with no second refund. Refunded tokens are withdrawable again. An `amount` edited behind the service's back is 422 `REFUND_NOT_MATCHED` with the request still PENDING, nothing minted, and the refusal succeeding once the row agrees with its debit. |
| Live flow, cap and throttle | Same database, server restarted so the in-process throttle had a clean budget. | 7 of 7 pass. Five waiting requests cut exactly 500 tokens; the sixth is 429 `TOO_MANY_PENDING`. A flood past the per-member budget is 429 `RATE_LIMITED` with a `Retry-After`, and no extra rows appear because the limiter answers before the service is called. |
| Live flow, gate closed | Server restarted with `MONEY_MODE=false`, then again with the variable unset in production. | 8 of 8 pass both times. Filing a payout, approving and refusing one are 503 `PAYMENTS_DISABLED`; the member's history, the admin queue and the wallet read stay open; admin sign-in still works; no refund row is written and the request stays PENDING. |
| Ledger invariant, live | `SELECT sum(amount) FROM transactions WHERE balance_type = 'WINNING'` compared with `winningBalance` after every path. | Equal (3800 = 3800). It also caught a mistake in the check script itself: deleting request rows with raw SQL left orphan debits, which is exactly the drift the invariant exists to expose. |
| Cleanup | Fixture users, wallets, ledger rows, deposit claims, payout requests, matches and admins removed from both databases; the seed and check scripts live outside the repo. | All table counts back to 0 in `cricket_platform` and `cricket_platform_test`. |

**Not verified in this sandbox:** a real UPI payout, so the `adminUtr` rules were exercised against synthetic references; a payout under load (the concurrency proof is two requests against one balance in the DB test, not a burst); the two-person approval and the hourly per-admin ceiling, which are not built; and Google sign-in end to end, as before.

---

## Appendix F: Verification log (match management and live scoring)

| Check | Method | Result |
|---|---|---|
| Migration applied | `prisma migrate deploy` on `cricket_platform` and `cricket_platform_test` | Applied to both. `\d matches` shows `matches_external_id_key`, `matches_status_start_time_idx`, `matches_start_time_id_idx` and five CHECKs; `\d live_scores` shows `live_scores_version_positive`, `…_balls_shape` and the runs/wickets bound. |
| Schema drift | `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url … --exit-code` | Exit 0, "No difference detected". |
| Schema validity | `prisma validate` | Valid. |
| Typecheck | `tsc --noEmit` | Exit 0. |
| Lint | `next lint` | Exit 0, no warnings. |
| Match DB tests | `vitest run tests/match.test.ts` (test database) | 34 of 34 pass. |
| Match HTTP tests | `vitest run tests/match-http.test.ts` | 37 of 37 pass. |
| Full suite | `vitest run` (test database, no server) | 408 pass, 77 skip across 16 files. `tests/admin-auth.test.ts` globs `src/app/api/admin/**/route.ts`, so its pass now covers the three new admin match files as well. |
| Full suite, live | `vitest run` with `next start` running against the development database | 473 pass, 12 skip. The contract suite runs instead of skipping itself, and `package.json`'s `test:integration` list now includes both match files. |
| Regression on shared modules | `vitest run tests/payment.test.ts tests/wallet.test.ts tests/withdrawal.test.ts` | All pass, after one honest change: `tests/payment.test.ts` used to seed a match whose `qrCodeUrl` was `"   "` to prove the QR picker skips blanks. The new `matches_qr_url_not_blank` CHECK makes such a row impossible to store, so the fixture now uses `NULL`, which is what the application can actually produce. `getActivePaymentQr` keeps its `gt: ""` filter as a guard for rows that predate the check, and the test says so. |
| Production build | `next build` | Exit 0. All seven match routes are dynamic (ƒ), as are the wallet, payment and withdrawal routes. |
| HTTP contract | `vitest run tests/http-contract.test.ts` against `next start` | 69 of 69 pass, 11 of them new. The public list is `public, max-age=…` with an ETag, and its raw bytes contain neither `qrCodeUrl` nor `externalId`; `/api/matches/live` returns 304 with an empty body on a matching `If-None-Match`, even for an empty page; `?limit=0` and `?q=` are both 400 anonymously; a nonexistent id is 404 `MATCH_NOT_FOUND` on both read shapes; all four admin routes are 401 before their query or body is read, with `no-store` on the list; a POST to `/api/matches` is 405; and `GET`/`PUT`/`DELETE` on `/api/admin/matches/:id` are 405, because there is no single-match admin read and no delete. |
| Live flow | `next start` with `MONEY_MODE=true` on the development database. A SCORE_ADMIN, a SUPER_ADMIN and a PAYMENT_ADMIN signed in over HTTP (cookie only — the guard reads no `Authorization` header), and one member session was minted from `NEXTAUTH_SECRET` for the payment-QR check. | 67 of 67 pass. Creation returns 201 with the QR and `hasQrCode`, `score: null`; the same teams swapped at the same kick-off is 409; a `status` key on create is 400; a one-sided fixture is 400 naming both teams in its message; PAYMENT_ADMIN is 403 on create and on the score write. An empty patch is 400; `qrCodeUrl: "   "` is 400 while `null` retires the link; a URL with no scheme is 400. A scorer may open a fixture and fix its kick-off in one save while nothing is played, but the next kick-off edit is 409 `MATCH_LOCKED` and only the super can make it. First score POST is 201 with `"48/1"` and `"7.2"` normalised and the writer named; a later `52` becomes `"52/1"` and `8` becomes `"8.0"`; `expectedVersion: 1` after version 2 is 409 `SCORE_STALE` with the current version; a board that goes backwards is 409 for the scorer and 200 for the super; `7.6` overs and a nested stats object are 400, the latter naming `batsmanStats.boundaries`; `"runs": "55"` arrives as the number 55. The public board has no `lastUpdatedBy` and no staff email. Five sequential writes leave five distinct versions. Closing is allowed for a scorer, after which only the super may correct the board; a super can reopen a match closed by mistake, and a scorer cannot relabel a played one. `GET /api/matches` includes the fixture with its score summary, is cacheable, and shows neither the QR nor the feed id; the admin list search finds it and shows both; a `q`-filtered `limit=1` walk in ascending order returns exactly the two fixtures created for it and ends on the second page. `GET /api/payment/qr` is 401 anonymously and 200 for a member, pointing at the fixture this script created — Phase 4 and Phase 6 meet on that row. |
| Cache behaviour, measured | `curl -D-` on `/api/matches/:id/score` twice, second with `If-None-Match`. | 200 with `ETag: W/"…"` and `Cache-Control: public, max-age=5, s-maxage=5, stale-while-revalidate=20, stale-if-error=300`; then 304 with the same two headers and no body. The tag is weak on purpose: `stale-while-revalidate` and `stale-if-error` both let a cache serve a copy that is legitimately not byte-identical to the origin's, and `generatedAt` on the live list is not part of the entity being identified. |
| QR audit | Server log during the live run. | `\[match] attached qrCodeUrl for <match id> by admin <admin id> (host: qr.example.test)`, then `(host: none)` on the clear, then `replaced`. The URL itself never reaches the log, and `AdminAuditLog` (§5.5) remains its intended home. |
| Cleanup | `node match-seed.cjs teardown` removed the fixtures, the three admins and the member from `cricket_platform`; the test database is reset by its own fixtures. Scripts live in `/tmp`, outside the repo. | Both databases left with no live fixture and no orphan scoreboard. |

**Not verified in this sandbox:** any real score feed — the endpoint a provider would use is the admin score route with `externalId` and `expectedVersion`, and it was exercised only by this app's own clients; settlement, because there is still nothing to settle; prediction locking, same reason; the cache numbers, which are reasoned (a 10 s poll against a 5 s `max-age`) rather than measured under load; the `4 KB` stats bound against a provider that sends a whole innings of strike rates, which the test covers but a live feed might not; and Google sign-in end to end, as in every previous appendix.

---

## Appendix G: Verification log (member snapshot, `GET /api/me`)

| Check | Method | Result |
|---|---|---|
| Typecheck | `tsc --noEmit` | Exit 0. |
| Lint | `next lint` | Exit 0, no warnings. |
| Snapshot tests | `vitest run tests/me.test.ts` | 9 of 9 pass (5 against PostgreSQL, 4 source-tree checks that need no database). |
| Full suite | `vitest run` (test database, no server) | 417 pass, 80 skip across 17 files. The skips are 8 artifact tests with no APK staged and 72 contract tests with no server. One total may move by a single test between runs: the bootstrap test in `tests/admin-bootstrap.test.ts` disables itself unless the database holds no real admin, which is a property of the shared test database, not of this change. |
| Production build | `next build` | Exit 0; `/api/me` is listed as a dynamic (ƒ) route next to the four public match reads. |
| HTTP contract, live | `vitest run tests/http-contract.test.ts` against `next start` | 72 of 72 pass, three of them new: 401 + `no-store` + no balance-shaped word in the body for a guest on `/api/me`; 405 for a POST to `/api/me`; and one table over the six member-facing reads asserting 401 for `/api/me`, `/api/wallet`, `/api/wallet/transactions` and 200 for `/api/matches`, `/api/matches/live`, `/api/matches?limit=1` — with `no-store` on the first group and a shared cache on the second. |
| Live flow | `next start` on the development database. A member was seeded with a wallet **and** the two ledger rows that justify it, plus one LIVE match carrying a scoreboard and a payment QR; the session cookie was minted from `NEXTAUTH_SECRET`. | 26 of 26 pass. `GET /api/me` returns the seven profile keys, `wallet` of `{400, 1250, 1650, 1150}` — byte-identical to `GET /api/wallet` in the same run — `stats` with both counters, `warnings: []`, and `no-store`. The wire contains no `googleId`, no `referredById`, nothing password-shaped. `/api/wallet/transactions` lists exactly the two rows, signed, newest first, and their sum per balance type reconciles to the cached balances. The calendar reads work anonymously: the list row for the live fixture carries `"137/3"` and `"17.4"` inline, the detail view agrees field-for-field with that row, the score-only poll is `max-age=5` with an entity tag and answers 304 with an empty body on the next poll, and none of the three responses contains `qrCodeUrl`, `externalId` or `lastUpdatedBy`. Five personal reads (`/api/me`, `/api/wallet`, `/api/wallet/transactions`, `/api/payment/qr`, `/api/withdrawal/my`) are 401 without a cookie. |
| Live edge cases | Same server, rows mutated under the still-valid cookie. | 5 of 5 pass. Delete the wallet row: `/api/me` still answers 200 with the profile, `wallet: null` and one warning naming the missing row, while `GET /api/wallet` for the same member answers 404 `WALLET_NOT_FOUND` — absence reported as absence, never as zero, and the two endpoints disagree only in how much they can show. Delete the member: `/api/me` answers 404 `NOT_FOUND` to a session that is still cryptographically valid (the 24 h resync window, review M4), and the public reads keep working for everybody else. |
| Cleanup | `node /tmp/me_seed.cjs teardown` removed the member, its wallet and ledger rows, and the MECHECK fixture. | Development database left with no fixtures from this check. |

**Not verified in this sandbox:** Google sign-in end to end, so the member session used here was a minted JWT rather than an OIDC round trip; `/api/me` behind a real refresh cycle (a session whose `syncedAt` is older than 24 h goes through the DB resync path, which this check did not exercise); and any client actually rendering this payload — no page was changed, the endpoint is API-only, and the dashboard still calls `/api/session` and `/api/wallet` separately.

**Also not built here, deliberately:** no `PATCH /api/me` (profile editing would need name and avatar rules, and the APK has no screen for it yet), no `GET /api/me/predictions` (there is nothing to predict with yet), and no aggregation of pending claims into the snapshot — `GET /api/wallet/transactions`, `/api/withdrawal/my` and the payment queue already answer that, and folding their counts in would be a second source of truth for one screen.

---

## Appendix H: Verification log (admin panel UI: login, dashboard, payments)

| Check | Method | Result |
|---|---|---|
| Typecheck | `tsc --noEmit` | Exit 0. |
| Lint | `next lint` | ✔ No ESLint warnings or errors (it still prints the "next lint is deprecated" banner; the repo has not moved to the ESLint CLI). |
| New panel tests | `vitest run tests/admin-web.test.ts` | 16 of 16 pass, none needing PostgreSQL. |
| Auth refactor is behaviour-preserving | `vitest run tests/admin-auth.test.ts` | 37 of 37 pass after `requireAdmin()` was split into `readAdminSession()` + a thin wrapper, which `getAdminPrincipal()` and therefore every page now share with the API. |
| Full suite | `vitest run` (test database, no server) | 432 pass, 92 skip across 18 files. |
| Production build | `next build` | Exit 0; `/admin`, `/admin/dashboard`, `/admin/login` and `/admin/payments` all listed as dynamic (ƒ). **The build caught what the typecheck could not:** the client sign-in form imported `ADMIN_HOME_PATH` from `admin-web.ts`, which imports `admin-guard` and therefore `next/headers` — "You're importing a component that needs next/headers". Fixed by putting the two paths in `src/lib/admin-paths.ts`, a module with no server dependency, and re-exporting them for server callers. That is the trap this whole phase kept hitting, and the reason `tests/admin-web.test.ts` exists. |
| HTTP contract, live | `TEST_BASE_URL=… vitest run tests/http-contract.test.ts` against `next start` | 83 of 83 pass, eleven new. The panel cases assert the wall from outside: `/admin`, `/admin/dashboard`, `/admin/payments` and `/admin/payments?status=PENDING` all hand an anonymous document request to `/admin/login` and carry no queue wording; a guarded page's `cache-control` contains `no-store`; the sign-in page renders, carries `noindex, nofollow` as a meta tag (Next does not raise an `X-Robots-Tag` header for metadata robots), leaks no role name and sets `autocomplete="current-password"`; `/admin/definitely-not-a-page` is 404, proving the guard is not a blanket rewrite; and `/api/admin/payments` still answers 401 JSON, so a page-level handoff cannot mask an endpoint. Two further cases run only when `ADMIN_TEST_EMAIL`/`ADMIN_TEST_PASSWORD` are supplied: a session renders the dashboard and never the sign-in form, and the cookie is `HttpOnly` with `SameSite=strict`. |
| Live panel flow | `next start` on the development database, `MONEY_MODE=on`, `ADMIN_SESSION_SECRET` overridden with a random 64-char value. Seeded: one `SUPER_ADMIN`, one `SUPPORT_ADMIN`, one member with a wallet, one PENDING claim of ₹2,500 with a UTR, one PENDING payout, one LIVE fixture carrying `"182/4"` at over `16.3`. 62 hand-driven checks over the real HTTP surface. | 62 of 62 pass. Signed out: the four admin URLs and a forged cookie all land on the sign-in page with no leak. As super admin: the dashboard greets by name, shows ₹2,500 grouped as `2,500`, the member, the UTR, `182/4`, "soon" on the three unbuilt sections *without* linking them, `href="/admin/payments"` on the built one, and a deep link to `#claim-<id>`; `/admin/payments?status=PENDING` renders the row with the referral code, the receipt as a link rather than an inlined image, and both review actions. `POST …/approve` with a note returns the new `depositBalance` of 2500 and a `DEPOSIT` ledger row; the row then sits on the APPROVED tab with the note and the reviewer's name, the PENDING tab says "Queue is clear", the dashboard no longer lists it, and `GET /api/admin/wallet/:userId` agrees with the credit to the rupee. As support admin: the same URL answers 200 with "Payments are not your queue" and *no* UTR in the body, the dashboard says "read-only for you" with neither money queue, the nav has no payments link, and the endpoint the panel would have called still returns 403. `POST /api/admin/logout` clears the cookie and the revoked session is handed back to sign-in. |
| Refusals worth keeping in mind | Same server, `MONEY_MODE` off for one run before the flag was turned on. | Approve answered 503 `PAYMENTS_DISABLED` while the panel rendered normally, and the shell's amber "MONEY_MODE is off" strip was the only thing saying so — which is exactly the behaviour §13 promises: the UI does not get to be more permissive than the flag. |
| Cleanup | `node /tmp/panel_teardown.cjs` | Member, wallet, ledger rows, claim, payout, fixture, scoreboard and both seeded admins removed; development database back to zero rows in every table this phase touched. |

**How the panel is wired, in one paragraph.** Pages read through the service functions (`listPaymentRequests`, `listWithdrawalRequests`, `listMatchesForAdmin`) because a server component has the database on hand and no cookie needs forwarding. Pages *write* through the API routes (`POST /api/admin/payments/:id/approve|reject`) via `adminCall()` in `src/lib/admin-client.ts`, which never throws, unwraps the `{ok,data}` envelope and turns a status into a sentence. A successful write raises a sonner toast and calls `router.refresh()`, so the queue comes back from the database rather than from the client's guess about what the balances became. That is a deliberate asymmetry: two doors into the review logic — one in the route, one in the page — is how a panel ends up crediting twice, and the whole point of the `MONEY_MODE` gate, the PENDING-only rule and the single-reviewer write is that they live in one place.

**Not verified in this sandbox:** no browser drove the forms. The dialog's client code path (validation copy, the busy state, `router.refresh()` after a toast) was checked by reading it and by calling the exact endpoint and body it produces — 62 live checks above — not by clicking it in a viewport. No responsive or visual pass was made: the classes come from `globals.css` and the existing primitives (`glass`, `neon-border`, `corner-brackets`, `Badge`, `Button` including its `loading` state, `Dialog`, `Input terminal`), but nothing here can screenshot the result. Google sign-in for members was not touched and the member dashboard still works as before (its suite is part of the 432). The rate limiter was exercised only through the API tests, not by hammering the login form.

**Left open on purpose, not by oversight:** the payout console, fixture console, score-entry form and QR picker are listed in the nav as "soon" because their pages do not exist yet, not because the APIs are missing. `/admin/qr` cannot upload an image — there is still no upload route and `lib/external-url.ts` refuses `data:` URLs, so it will set `qrCodeUrl` from a pasted HTTPS address via `PATCH /api/admin/matches/:id`. There is no `AdminAuditLog` (the reviewer id on the row is all the trail there is), no two-person approval, and no reversal path for an approved claim — the panel says "cannot be undone" because that is the truth.

---

## Appendix I: Verification log (final polish: seed script, one envelope, the retained floor, docs)

| Check | Method | Result |
|---|---|---|
| Seed exists and is safe to run automatically | `npx tsx scripts/seed.ts` run five ways against the development database, plus `prisma migrate reset --force` against a scratch database | The admin step delegates to `createFirstSuperAdmin`, so there is still one password policy and one "any admin exists → change nothing" rule; `SEED_TEST_MATCH=1` creates (and on a re-run *repairs*, never duplicates) the fixture tagged `seed-demo-match`; `=live` additionally moves it to LIVE and writes a `0/0`, over `0.0` scoreboard row, and a second `live` run leaves `version` alone because the seed now reads `liveScore.findUnique` before writing. Exit 0 with a stderr warning when `ADMIN_EMAIL`/`ADMIN_PASSWORD` are unset — required, because `prisma.seed` runs it inside `migrate dev`/`reset`, which cannot be expected to invent a password. Exit 1 only for a value the policy refuses or a genuine database failure. |
| The seed does not become a second owner of money state | read of the final file | It touches `AdminUser` and `Match`/`LiveScore` and nothing else: no wallets, no claims, no approvals, no ledger rows. A reset database still has zero members, which is what §4 promises about empty states. |
| `ADMIN_NAME` cannot break a reset | scratch database, `migrate reset` with email + password and no name | Found and fixed during this pass: `bootstrapInputSchema` requires a display name, so the seed aborted the reset it was supposed to make convenient. The seed now falls back to the email's local part and prints that it did; `admin:create-super` still demands all three, which the docs now say in those words. |
| One response envelope, on every route | `tests/api-envelope.test.ts` — 111 assertions walked off the file tree, not a hand-kept list | 29 ownable route files export `handle<METHOD>` wrapped by `guardRoute("<its own path>", …)`; `NextResponse.json(` appears in none of them and neither does an inline `ok: false`; `NextResponse.redirect`/streamed bodies remain only where they must (the APK mirror). `auth/[...nextauth]` is the single exempt file. Error bodies are exactly `{ok:false, error, code}` with `details` when non-empty. |
| Wire compatibility for the shipped APK | live `curl` against a rebuilt `next start` | Success payloads unchanged in shape and field names (`session`, `referral`, `download`, `health`). Deliberate wording changes: `/api/session` and `/api/wallet` now share `"Not authenticated"`, `/api/download`'s 401 keeps its own sentence, `referral`'s 429 keeps `Retry-After: 60`, and `/api/referral`'s 400/404/429 became `no-store` through `apiJson`. A 405 that a route defines itself names `Allow`. |
| A thrown error is never an HTML page | stopped PostgreSQL, `curl /api/matches` | `500 application/json {"ok":false,"error":"Something went wrong. Please try again.","code":"INTERNAL_ERROR"}`, and `/api/health` → `503` with its own `Database unreachable` body. Restarting the database recovered the server without a restart. |
| Every 500 leaves a trace, and the trace is clean | grep over the server's log file | Found during this pass: every route catches into its domain mapper, so `guardRoute`'s log line almost never fired and a mapper's 500 was logged by dumping the raw error object — whatever that object carries. Added `logApiError(context, error)` in `src/lib/http.ts` (one redacted line, stack included) and routed all four mappers plus `internalErrorResponse` through it. The live DB-down run now prints `[match] unhandled error: PrismaClientKnownRequestError: …`, and the whole log contains `cricket_dev_password` 0 times, `postgresql://` 0 times, a JWT fragment 0 times. Three existing mapper tests asserted the old call shape and were updated to the new contract. |
| The retained floor is enforced by the writer | `src/lib/wallet.ts`, `tests/minimum-balance.test.ts` (11 tests) | The rule used to live only in `debitWinning`; `applyMovement` — the single writer of balance columns — checked `MAX_BALANCE` and nothing below. Both checks now sit in `applyMovement`: a negative delta on the deposit balance is refused outright ("A deposit balance is never debited…"), and a negative delta that would leave `winningBalance` under `MIN_RETAINED_WINNING_TOKENS` raises `MINIMUM_BALANCE` with the member-facing sentence. `debitWinning` keeps its earlier check so no status code or message changed. The suite also pins the invariant structurally: the constant is declared once, no module outside the wallet service writes a balance column, no `src/app/api/**` route reaches for `prisma.wallet`, and the payout rule imports the same number. |
| Docs say what is built | `DEVELOPMENT.md`, `docs/TESTING_CHECKLIST.md`, README §16 + a pointer at the top, `.env.example` | `SEED_TEST_MATCH` is documented where a developer will look for it. The README scripts table gained the rows it was missing (`db:setup`, `db:seed`, `admin:create-super`, `test`, `test:run`, `verify`) and the truth that `db:reset` re-seeds. The checklist is written so a tester cannot mistake a skip for a pass, and its section H lists the gaps (no un-approve, no score history, no upload route, panel pages 4–7) as things to confirm are *documented* rather than things to test. |
| Full gate | `npm run verify` = typecheck && lint && `vitest run` && build | Exit 0. `✔ No ESLint warnings or errors` (the two unused-import warnings the refactor introduced were fixed at their source). **631 passed, 15 skipped across 20 files.** Build clean. |
| Live HTTP contract, on this build | `TEST_BASE_URL=http://127.0.0.1:3000 npx vitest run tests/http-contract.test.ts` with `ADMIN_TEST_*` supplied | **83 of 83 pass**, run against a freshly rebuilt `next start` (twice, before and after the logging change). |

**Not verified in this sandbox:** the checklist's manual sections (C, D, E, F panels, G) were authored, not walked by a second person in a browser; nobody clicked through `F1–F8` on a phone-width viewport in this pass, and `G7`'s claim that no upload surface exists is a read of the route tree plus the missing route, not a fuzz.

**Left open on purpose:** `redactSecrets` is a pattern list, so a secret that arrives in a shape it does not know still reaches the log — the durable fix is not logging error objects at all, which the four mappers now do but third-party libraries do inside their own `console.error` calls (Prisma's `prisma:error` lines are its own, and were checked for leakage rather than changed).

## Appendix J: The member app (Expo) and the bearer path it needed

The React Native app lives in this repository at **`mobile/`**, as its own npm project: its own
`package.json`, lockfile, `README.md` (setup, login, APK build, troubleshooting) and `tsc` gate, with
nothing installed across the boundary. Keeping one tree means the API contract and the client that
codes against it move in one commit, which is worth more than the tidiness of two repositories —
but only while the backend's gate stays blind to it. So the root `tsconfig.json` excludes `mobile`
(its `include` is every TypeScript file in the repo, which would otherwise typecheck React Native
under Next's config) and `.eslintrc.json` ignores `mobile/` (Next's rules would judge a phone app by
web idioms, and someone would oblige them). `tests/mobile-boundary.test.ts` pins both exclusions,
that no backend file imports into `mobile/`, that the app imports no `@/` or `next/` module, and —
the one that would matter most if it ever lapsed — that no URL in the app's service layer contains
`admin`, because this client is a member's and an admin path in it would mean a staff surface being
reached with a member's token.

Two details found by building rather than reading: `expo prebuild` aborted on this project until
`app.config.ts` stopped pointing `adaptiveIcon` at an `adaptive-icon.png` the SDK 57 template does
not ship (it ships three layers now), and the app's own `tsconfig` had a `@/* → ./src/*` alias that
nothing used — removed, because inside `mobile/` that alias resolves to the app while the same
specifier in a backend file resolves to `src/`, which is a bug that compiles.

What the app required from the backend is one thing: a way to authenticate without a cookie. It did
not need a new money surface, a new id, or a new permission.

| Check | Method | Result |
|---|---|---|
| A second credential, without weakening the first | read of `src/lib/member-auth.ts` | `requireMember()` tries `Authorization: Bearer …` (case-insensitive, `readBearer` rejects anything that is not a bearer attempt) **before** the NextAuth cookie, and a bearer attempt is answered on its own terms: a bad token is a 401/503, never a fall-through to the cookie. The comment in the file states why — a client holding both credentials would otherwise act as whichever identity was cached, and that is a bug nobody sees until a wallet is credited to the wrong person. `headers()` is wrapped in a `try` because the module is also imported by scripts, where there is no request store. |
| Token shape, and what is *not* trusted | read of `src/lib/member-token.ts` | HS256, issuer **and** audience `cpc-member`, `typ: "member-access"`, `uid`, `exp` at 30 days (`MEMBER_TOKEN_TTL_SECONDS`), `clockTolerance: 5`. Signature plus issuer/audience are not enough: `verifyMemberToken` rejects any payload whose `typ` this function did not mint, so a validly signed token from another purpose is not a session. Only `uid` is returned to callers; the `email` claim is a label. Secret is `MEMBER_TOKEN_SECRET` else `NEXTAUTH_SECRET`, and `getMemberTokenSecret()` refuses anything shorter than 32 characters instead of deriving a key from a README value. |
| Admin routes unreachable with a member token | grep for `authorization` in `src/lib/admin-guard.ts` and `src/lib/admin-session.ts` | **No matches**: the admin guard reads only its own httpOnly cookie. The mint function takes a member id and never consults `AdminUser`. The split is therefore structural rather than a permission check that could be forgotten. |
| Revocation, honestly | read of `requireMember()` | There is none, and it is documented as such: no `tokensRevokedAt`, no per-request row read. A leaked token is valid until it expires; a deleted member row yields empty results, not somebody else's wallet. Early revocation means rotating the secret, which signs out every member — recorded in `DEVELOPMENT.md` §3 rather than hidden, because "the app stores a 30-day token" invites the question. |
| Sign-in endpoint | read of `src/app/api/auth/mobile/route.ts` | Body is `.strict()` with exactly one of `idToken` / `accessToken` / `code`+`verifier`, plus optional `referralCode` (4–24). `createRateLimiter({limit: 8, windowMs: 15 * 60 * 1000})` keyed on client IP → `429` with `Retry-After`. `memberAuthConfigured()` gates the whole route on the **signing secret** (it calls `getMemberTokenSecret()` and nothing else) → `503 AUTH_NOT_CONFIGURED`; the Google paths separately require a non-placeholder client id via `allowedGoogleAudiences()`. Exported as `guardRoute("api/auth/mobile", handlePOST)` like every other route, so it is inside the envelope assertion. |
| Browser handoff, no native OAuth client | read of `src/lib/mobile-handoff.ts` + `src/app/mobile/start/route.ts` | App-side: 43–128 char verifier, S256 challenge. Server-side: `?challenge=` length-checked (43–128) and a bad one is a **plain-text 400**, not an HTML redirect; an unauthenticated browser is 302'd to `/login?next=/mobile/start?challenge=…` so the handoff resumes after sign-in; the code is HS256 with audience `cpc-mobile-handoff`, `HANDOFF_TTL_SECONDS = 120`, and 302s to `cricketmobile://auth?code=…` (`MOBILE_REDIRECT_SCHEME`). Single-use is an in-process `jti` map with a 150-second retention — the file states plainly that multi-instance deployment means a table, and the swap is described as mechanical. `?redirect=none` prints the code for Expo Go, where no custom scheme is registered. |
| Dev mint cannot become a live hole | read of `scripts/issue-member-token.ts` | Exits non-zero when `NODE_ENV=production`; mints only for an email that already exists as a member (it cannot create an account) and prints the `curl` form so the token is testable from a shell. `npm run mobile:token -- <email>`; the `MEMBER_TOKEN_SECRET`/`GOOGLE_*` wording in `.env.example` §3b was rewritten this pass because it attributed the `503` to the Google variables, which `memberAuthConfigured()` does not read. |
| The app codes against real payloads, not invented ones | grep of each route's `apiSuccess(...)` before writing each service | Five guesses were caught and corrected: the wallet is `{depositBalance, winningBalance, total, withdrawableBalance}`; the score endpoint returns `{match, score}`, not a bare score; `/api/matches` takes `status&from&to&order&limit&cursor`; `WithdrawalReceipt` carries `wallet` + `transaction`, and the member list rows carry `reviewNote`/`adminUtr`; **`GET /api/wallet/transactions` parses only `limit` and `cursor`**, so the `type`/`balanceType` filters that had been drafted into `src/services/wallet.ts` were deleted rather than left as controls that silently do nothing. |
| `GET /api/referral` is a validator, not a summary | read of the route | `?code=` (4–24) → `{code, referrerFirstName}`, `400`/`404`. `docs/TESTING_CHECKLIST.md` C4 had claimed it returned `link`/`referralCode`/`referralCount`/`totalEarned`/`tier` and validated `?limit=` — both invented. C4 was rewritten to describe the validator, and the app's `ReferralSummary` type was replaced with `ReferralCheck`. The profile screen therefore builds its own invite link from `EXPO_PUBLIC_API_URL` + the member's own code, which is the only honest source for it. |
| App typechecks | `npx tsc --noEmit` over `app/` + `src/` (40 files; the config plugin is plain JS and outside the gate) | Exit 0. Twelve errors were cleared to get there, and the three that say something about the platform: `headerBackTitleVisible` and `StyleSheet.absoluteFillObject` are not in this React Native's types, `react-native-paper` exports `MD3Theme` and no `Theme`, and **`@react-navigation/bottom-tabs` is not importable at all** — SDK 57 vendors it under `expo-router/build/react-navigation/`, so the custom tab bar declares the slice of `BottomTabBarProps` it reads structurally and the mismatch at the call site (`tabBarLabel` may be a render function upstream) is what forced the coercion. A dependency you cannot name is a dependency you cannot type, and that was found by the compiler, not on a phone. |
| App bundles | `npx expo export --platform android` | Exit 0, `Android Bundled … (1429 modules)`, assets collected. This is the strongest end-to-end check available without an emulator: Metro resolved every import, Expo Router compiled the route tree, and the config was accepted. |
| App config sanity | `npx expo-doctor` | `21/21 checks passed. No issues detected!` Run after `expo-splash-screen` was dropped (the loading gate lives in the `(protected)` layout, so the native hold was redundant) and after `android.edgeToEdgeEnabled`, `android.usesCleartextTraffic` and the top-level `splash` key were removed as keys this SDK's `ExpoConfig` type rejects — cleartext is Expo's debug/release split to make, not ours to widen. |
| First real Android artifact | `npx expo prebuild --platform android` then `./gradlew assembleRelease`, on a 2 GB / 2-core box with 5 GB of swap | Both exit 0. `app-release.apk`, 38,459,023 bytes, arm64-v8a, minSdk 24 / targetSdk 36, `assets/index.android.bundle` (2.6 MB, Hermes) inside it, so it needs no dev server. Inspected rather than trusted: `aapt2 dump badging` for the package/version/permissions, `apksigner verify --print-certs` for the signer, and the compiled `EXPO_PUBLIC_API_URL` grepped out of the bundle. |

**Two bugs the build found that reading could not.** `app.config.ts` pointed `adaptiveIcon` at
`./assets/adaptive-icon.png`, which the SDK 57 template does not ship — `expo prebuild` aborted on
it, and any `eas build` would have too, so the config was wrong in a way no typecheck can see (the
template now uses the three layers it actually has). And the app's own `tsconfig.json` carried a
`@/* → ./src/*` alias that nothing used; inside `mobile/` it resolves to the app while the same
specifier in a backend file resolves to `src/`, so a future import could compile against the wrong
tree. Removed, and asserted against by `tests/mobile-boundary.test.ts`.

**Not verified in this sandbox:** the app was never run on a device or emulator — no emulator here —
so every screen is proven to *bundle*, *typecheck* and *package into an installable APK*, not to lay
out on a phone or survive a real tap sequence. Google sign-in was never exercised end to end: no
real client id exists in this environment, so the exchange path is verified by reading the guard
clauses, not by trading a token. The APK is signed with the template's debug key (what the bare
`release` config uses), so it is sideload-test material only. `eas build` was never invoked, so the
cloud path in `mobile/README.md` is assembled from `eas.json` and the CLI's own profile names, not
executed. And the `npm install --legacy-peer-deps` workaround is documented because a bare install
fails here on `react-dom@19.3.0` versus `react@19.2.3` — a peer-range disagreement inside the Expo
template, reproduced once, not root-caused upstream.

**Left open on purpose:** the low-RAM build flags (`-g0` for the native objects, one ABI, no daemon,
`android.r8.maxWorkers=1`) live in a local `android/` that is generated and git-ignored rather than
in the committed config, because they are this machine's constraint and not the app's; they are
written out in `mobile/README.md` §6 instead. The permission-trimming config plugin *is* committed,
since the manifest it produces is what ships.

**Also left open:** the APK is not referenced by the web app's Download Center, and
`public/downloads/` does not exist in this repository — the site's download button still points at
whatever `APK_DIRECT_URL` says. Publishing this artifact there is a copy and an env var, not code.

The app has no prediction-bet UI. Everything in the phase list the member
asked for is present — auth, matches, live score, wallet, deposit claim, payout, ledger, profile —
and placing a bet is deliberately not, because the stake rules, the settlement copy and the odds
display are the parts of this product a lawyer will read first; shipping them in a second client
before the first is reviewed would double the surface without new information. Payment screenshots
stay on-device (`EXPO_PUBLIC_UPLOAD_URL` optional) because the backend has no upload endpoint and
`assertScreenshotUrl` trusts only https hosts on its own allow-list — inventing a URL field the
server would reject is worse than a claim filed with a note saying so. There is no clipboard
permission for the referral code: `expo-clipboard` failed to install in this environment and the
`Share` sheet is the better answer anyway, so the dependency was removed rather than worked around.
And the money endpoints remain gated by `MONEY_MODE`, which the app renders as its own 503 message:
honoured by configuration, not by absence, so the day counsel answers the question in §2 nothing has
to be rebuilt.
