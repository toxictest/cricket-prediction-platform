# System Design: Cricket Prediction Community Platform

| | |
|---|---|
| Status | Draft v0.1, for review (not approved) |
| Date | 2026-10-09 |
| Baseline | Commit `66ad299` plus migration `20261009114731_add_admin_wallet_match_ledger` |
| Companion | `cricket-platform-review.md` (code review, findings C1–L5) |

---

## 0. Summary

- **As built today:** Google sign-in, referral codes, a gated APK download with an audit log, a legal and marketing site, admin login with RBAC (Phase 2), a wallet ledger service with member and admin read APIs (wallet change), and the deposit request system: a member reads the match QR, files a UTR claim, and a payment reviewer approves or rejects it (payment change). There is **no** prediction or scoring endpoint yet. One route moves value, `POST /api/admin/payments/:id/approve`, and it is behind `MONEY_MODE` (§13). Several docs and marketing claims describe features that do not exist (review C1–C5).
- **Data model:** 5 enums and 7 tables for admin users, wallets, payment claims, withdrawal requests, matches, live scores, and a transaction ledger (Phase 1). Then `admin_sessions` (Phase 2), the ledger guards in `add_wallet_ledger_guards` (wallet change), and the queue indexes and CHECK constraints in `harden_payment_requests` (payment change). No admin or member UI exists for any of it yet: the payment flow is API-only.
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
| G1 | Paid entry or deposit, with expected winnings, is an OMG. Skill does not matter. | `MONEY_MODE` is implemented in `src/lib/feature-flags.ts`: filing a deposit claim and approving one are refused with 503 unless the flag is on, and an unset flag means off in production. Counsel's sign-off is still the precondition for turning it on. |
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
            ├─ /api/wallet[/transactions] .. member balances and ledger (read-only, session required)
            ├─ /api/payment/qr, /request ... deposit QR and claim filing (session required, MONEY_MODE gated)
            ├─ /api/admin/payments* ........ review queue, approve, reject (requireAdmin + PAYMENT_ADMIN or SUPER_ADMIN)
            ├─ /api/admin/* ................ admin login, logout, me, member wallet view (requireAdmin on every route except login and logout)
            └─ /api/health ................. SELECT against PostgreSQL
PostgreSQL (Neon) ◄── Prisma 6.19.3 (src/lib/prisma.ts)
```

Key facts:

- **Provisioning:** `src/lib/user.ts` `provisionUser` creates a member on first sign-in. It allocates a `CRC-XXXXXXXX` referral code (`crypto.randomInt`, 30-character alphabet) and attributes the referrer once. Self-referral is blocked. The same write creates the member's zero-balance wallet, so a member never exists without one.
- **Build:** `vercel-build` runs `prisma generate && prisma migrate deploy && next build` (package.json).
- **APK distribution:** `*.apk` is gitignored and `storage/apk/` ships empty. Artifact resolution uses `process.cwd()` (review H1), so the download path does not work on Vercel as shipped.
- **Tests:** Vitest, 12 test files. Without a staged APK or a running server, 243 tests pass and 59 are skipped (test database; see Appendix C and Appendix D).
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
3. A payment or withdrawal leaves `PENDING` exactly once. *Payments: enforced and tested. `approvePaymentRequest` locks the row with `SELECT … FOR UPDATE`, then runs `UPDATE … WHERE id = ? AND status = 'PENDING'` and requires exactly one row. Withdrawals: still planned, because no withdrawal endpoint exists.*
4. Balances never go negative. *Enforced twice: CHECK constraints on `wallets` and `balance_after`, and the minimum rule in the service. Tested.*
5. Ledger rows are never updated or deleted. *Planned: DB grants. Not applied.*
6. Every admin write has an audit row. *Model not yet added.*
7. Predictions are accepted only while `now < match.startTime`, using the server clock. *Planned.*
8. A withdrawal leaves at least 100 winning tokens in the wallet (`MIN_RETAINED_WINNING_TOKENS`). *Enforced in `debitWinning` under the wallet lock. Tested, including 25 concurrent withdrawals.*
9. One UTR buys one credit, ever. *Enforced twice: the unique `payment_requests.utr_number` index, and the unique `(user_id, type, reference_id)` ledger index, where the reference is the payment id. Tested, including two reviewers approving the same claim at the same moment: one credit, one ledger row.*
10. `tokensToCredit` is never chosen by the member. *Enforced in `createPaymentRequest` (the server computes it from `amount` and `TOKENS_PER_RUPEE`) and by a strict body schema that rejects the field. Tested.*

### 5.5 Schema gaps and recommended changes

The fields were kept exactly as specified. The gaps below should be closed before any money use (P0) or before predictions launch (P1). P2 is needed before public launch.

| Pri | Gap | Recommendation |
|---|---|---|
| P0 | `transactions` has no status | Add `status` (PENDING / POSTED / REVERSED) so withdrawals can hold funds and be reversed. *Still open. It blocks withdrawal holds (§6.5).* |
| P0 | `transactions.amount` is unsigned and has no direction | **Done** (`add_wallet_ledger_guards`): signed `amount` and `balance_after`. |
| P0 | `balanceType` is free text | **Done**: enum `BalanceType { DEPOSIT, WINNING }`. |
| P0 | Money stored as `Int` in INR and tokens | Store paise as `BigInt`. `Int` tops out at 2,147,483,647, which is about ₹2.15 crore in paise, and sums can overflow. |
| P0 | `tokensToCredit` is supplied by the client | **Done**: `createPaymentRequest` computes `amount × TOKENS_PER_RUPEE`, and the body schema rejects the field, so a client cannot mint its own rate. A rate table per match or promo still does not exist; there is one constant. |
| P0 | `wallets` cascade on user delete | Change to RESTRICT. Anonymise users instead of hard-deleting them. |
| P0 | No CHECK constraints | **Done** for `wallets`, `transactions` (four CHECKs) and `payment_requests` (positive `amount` and `tokens_to_credit`), all raw SQL. `withdrawal_requests` still has none. |
| P0 | No indexes on FK columns | **Partly done**: `transactions` has `(user_id, created_at)` plus the unique `(user_id, type, reference_id)`; `payment_requests` has `(user_id, created_at)` and `(status, created_at)`. `withdrawal_requests` still needs both. Postgres does not index FK columns automatically. |
| P0 | No audit trail for admin actions | Add `AdminAuditLog { id, adminId, action, entity, entityId, before Json?, after Json?, ipHash, createdAt }`. |
| P1 | No prediction model | Add `Prediction { id, userId, matchId, pick, lockedAt, points Int?, settledAt, createdAt }` with `@@unique([userId, matchId])`. |
| P1 | Scores stored as display strings (`"182/4"`) | Use integer `runs`, `wickets`, and `balls`, plus a `version` column for optimistic locking. |
| P1 | No ball-level events | Add an append-only `BallEvent` table so scores can be replayed and corrections audited. |
| P1 | `matches` has no external ID or status-time index | Add `externalId String? @unique` and an index on `(status, startTime)`. |
| P2 | No consent or deletion-request records (DPDP) | Add `ConsentRecord` and `DeletionRequest` before the site makes privacy promises. |

---

## 6. Key flows

### 6.1 Member sign-in (as built)

1. Google OIDC callback. NextAuth `signIn` calls `provisionUser` (`src/lib/user.ts`).
2. The lookup matches on `googleId` OR `email`. This is review H4: it rebinds `googleId`, and `email_verified` is not checked. Fix before linking admins or money.
3. The referral cookie `cpc_ref` is applied once. Self-referral is blocked.
4. A 30-day JWT session is issued. The DB resync runs every 24 h and clears the user ID if the account was deleted, so a deleted user can keep access for up to 24 h (review M4).

### 6.2 Match lifecycle and live scoring (proposed)

1. SCORE_ADMIN creates a match with status `UPCOMING` and a `startTime`.
2. At the toss or start, status moves to `LIVE`. Predictions lock at `startTime`, enforced on the server, not only in the UI.
3. Score update: `POST /api/v1/admin/matches/:id/score` with the expected `version`. In one DB transaction, check the version, update `live_scores`, write the audit row, and bump the version. A mismatch returns 409.
4. Members read `GET /api/v1/matches/:id/score` with an `ETag` and `s-maxage=5`, polling every 10 s. Move to server-sent events only if polling proves insufficient.
5. Provider ingest, if chosen: a cron job every 30–60 s, with idempotent upserts keyed by `externalId` and ball sequence.
6. Status moves to `COMPLETED`. A settlement job scores each prediction once (guarded by `settledAt IS NULL`) and refreshes the leaderboard.

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

**Built so far:** `debitWinning(userId, amount, withdrawalId, description, { tx })` debits the winning balance immediately and writes a `WITHDRAWAL` row with a negative amount. It rejects any debit that would leave fewer than 100 winning tokens, with `MINIMUM_BALANCE` and the message "Minimum 100 tokens must remain in wallet". It does not implement the PENDING hold in step 1, because the ledger has no status column yet (§5.5). A rejected withdrawal therefore needs a REFUND reversal, which is not built.

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

**Built payment endpoints** (payment change). Same path style as the wallet change.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/payment/qr` | Member | QR of the newest LIVE match, else the newest UPCOMING one. 404 `NO_ACTIVE_QR` when neither has a URL. `Cache-Control: no-store`, because a stale QR sends money to the wrong account. |
| POST | `/api/payment/request` | Member | `{ amount, utrNumber, screenshotUrl }` → 201 and a PENDING claim. 400 validation, 409 `DUPLICATE_UTR`, 429 `TOO_MANY_PENDING` or the per-account throttle, 415 for a non-JSON body. |
| GET | `/api/admin/payments` | PAYMENT_ADMIN, SUPER_ADMIN | `?status=&limit=&cursor=&userId=`. Keyset-paged, newest first, plus `counts` for the whole queue. |
| POST | `/api/admin/payments/:id/approve` | PAYMENT_ADMIN, SUPER_ADMIN | Body `{}` or `{ reviewNote }`. One transaction: lock, conditional update, credit, ledger row. 409 on a replay. |
| POST | `/api/admin/payments/:id/reject` | PAYMENT_ADMIN, SUPER_ADMIN | Body `{ reviewNote }`, required. No wallet write. |

**Does any endpoint move money?** One does: `POST /api/admin/payments/:id/approve` credits `depositBalance`. It is reachable only while `MONEY_MODE` allows it (§13), and filing a claim is gated identically, so a production deploy with the flag unset exposes no deposit funnel at all — nothing can be paid in, and nothing can be credited. `GET /api/admin/payments` is deliberately not gated, so a reviewer can always read what was filed while the feature is dark. Winnings, withdrawals and manual adjustments still have no endpoint; those functions are called only from server code.

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

- **Existing:** Vitest unit suites (71 tests pass without an APK or server), DB-backed provisioning tests, and HTTP contract tests (these need a running server).
- **Wallet (added):** 36 DB-backed tests (`tests/wallet.test.ts`) cover the rules, the exact minimum message, duplicate references, history paging, ledger-to-balance reconciliation, a 25-way concurrent withdrawal race, caller-transaction rollback, and a rolled-back user when the wallet insert fails. 17 pure tests cover the HTTP helpers (`tests/wallet-http.test.ts`).
- **Payment (added):** 40 DB-backed tests (`tests/payment.test.ts`) cover claim creation and its validations, UTR normalisation and reuse across members, the pending cap, the QR preference order and the blank-QR skip, approve (balance, ledger row, reviewer, partial approval), a replayed approval, two admins approving at once, rejection with and without a note, the rollback that keeps a claim approvable when the member has no wallet, and the queue's filter, paging and counts. 39 pure tests (`tests/payment-http.test.ts`) cover the `MONEY_MODE` resolution table, the error envelope for both domain error classes, the content-type guard, and both body schemas.
- **To add:**
  - Schema invariant tests. Port the 14 behavioural checks run in this change into Vitest.
  - A member-facing claim list test, once that endpoint exists.
  - RBAC matrix test for every admin route.
  - Prediction lock tests with an injected clock.
  - Score-update version-conflict test.
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

- `MONEY_MODE` (built, `src/lib/feature-flags.ts`). Gates the deposit funnel: filing a claim and reviewing one. `true`, `1`, `on`, `yes` or `enabled` is on; `false`, `0`, `off`, `no`, `disabled` or an empty value is off; unset or unrecognised is **on outside production and off in production**, so a fresh production deploy exposes nothing until someone sets the value deliberately. Read per request, server-side only, never `NEXT_PUBLIC_`.
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

- Admin auth: TOTP is still to do. Login, logout and the RBAC guard are built. `AdminAuditLog`. Match CRUD. Score-entry API. Public score endpoint with caching. CI pipeline.

**Phase 2: predictions and leaderboard (free-to-play)**

- Prediction model and lock rules. Settlement job. Leaderboard. The P1 schema changes.

**Phase 3: money (only if counsel approves a model)**

- Wallet service and ledger guards are built. The deposit path is built end to end (QR, claim, queue, approve, reject) behind `MONEY_MODE`, and it is the only money-moving route in the product. Still open: the ledger status column, withdrawal holds and reversals, reconciliation, KYC and tax design, the presigned proof upload, and `AdminAuditLog` for both review actions. Check whether a payment gateway or bank will accept the flow.

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
