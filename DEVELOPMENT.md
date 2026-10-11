# Development guide

The loop you actually run: set a database up, seed it, sign in as staff, move fake money through
the deposit and payout queues, push a live score. `README.md` is the long reference and
`docs/SYSTEM_DESIGN.md` is where the *why* lives — §5 for the ledger, §5.5 for what a wrong
approval does, §15.1 for what is still open. This file only tells you how to drive the thing.

---

## 1. Running it

Node ≥ 18.18, PostgreSQL ≥ 14 (development used 17), npm.

```bash
npm install          # postinstall runs `prisma generate`
npm run db:setup     # role + database + shadow database + migrations; writes a .env if none exists
cp .env.example .env.local
npm run dev          # http://localhost:3000
```

`.env.local` is the file to edit — gitignored, and it overrides anything `db:setup` wrote into
`.env`. Minimum set for a working install:

| Variable | Needed for |
| --- | --- |
| `DATABASE_URL` | everything (written by `db:setup` for the default local database) |
| `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | member sign-in with Google |
| `ADMIN_SESSION_SECRET` (≥ 32 chars) | the admin panel and every `/api/admin/*` route |
| `APP_URL`, `DOWNLOAD_ALLOW_HOSTS` | the APK link and `screenshotUrl` validation |

Then:

```bash
npm run typecheck     # tsc --noEmit, no Next layer
npm run lint
npm test              # vitest; database-backed files skip themselves when Postgres is unreachable
npm run build && npm start
npm run verify        # typecheck + lint + test:run + build — what CI would run
```

Two things to know before your first request:

- **Money is gated.** Every endpoint that moves value checks `MONEY_MODE`: development defaults to
  `on`, production defaults to `off`, so a forgotten variable makes the queues return
  `503 PAYMENTS_DISABLED` instead of crediting strangers. `npm run dev` has them open.
- **Nothing is seeded on install, and that is deliberate.** The only way to become a member is a
  real Google sign-in, so a database with no admins and no users is the correct empty state.
  `npm run db:seed` exists for the cases below.

## 2. First admin

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-passphrase-of-12+-chars' npm run db:seed
```

`npm run db:seed` is the one command; `npm run admin:create-super` is the same code if you prefer
to be explicit. Both call `createFirstSuperAdmin()` in `src/lib/admin-bootstrap.ts`, which refuses
to do anything once *any* admin row exists — the check and the insert share a transaction on a
locked row, so two people seeding at once cannot produce two superusers. To create the first admin
on a database that already has one, use the panel or edit the row directly; there is no CLI
override, because an override is how a production box ends up with a surprise account.

Rules the same function enforces, whichever entry point you use: email lower-cased and unique;
password ≥ 12 characters with letters **and** digits, stored as a 12-round bcrypt hash; the
account is created with `SUPER_ADMIN`. `ADMIN_NAME` is optional *for the seed only*: when it is
unset the email's local part becomes the display name, so a missing label cannot abort a
`prisma migrate reset`. `npm run admin:create-super` still requires all three. `SEED_TEST_MATCH=1` also drops in an
unpublished test match with a placeholder QR fixture; see §4.

**Signing in as staff:** `/admin/login` → 15-minute `jose` JWT in an httpOnly `__Host-`-prefixed
cookie, `adminSessionVersion` bumped on logout so stolen cookies die. `requireAdmin([...roles])`
in `src/lib/admin-guard.ts` guards every `/api/admin/*` route; the role list is explicit per route
and does **not** imply `SUPER_ADMIN` — `SUPPORT_ADMIN` alone cannot review a payment.

| Role | Can do |
| --- | --- |
| `SUPER_ADMIN` | everything, including escalated score/status edits and role management |
| `PAYMENT_ADMIN` | payment queue **and** payout queue |
| `SCORE_ADMIN` | matches, live scores, the payment QR settings |
| `SUPPORT_ADMIN` | signs in and sees the dashboard; no money endpoints |

If `ADMIN_SESSION_SECRET` is missing or looks like a placeholder, admin routes fail closed rather
than signing sessions with a value copied out of a repository.

## 3. Deposits and payouts

Both queues exist so a human, not code, decides whether money moved. Nothing in the system talks
to a payment gateway.

### Deposit: member claims, admin credits

```bash
curl -s localhost:3000/api/payment/qr                     # which fixture to pay into
curl -s -X POST localhost:3000/api/payment/request \
     -H 'authorization: Bearer <member token>' \
     -d '{"amount":500,"utrNumber":"UTR1234567890","screenshotUrl":"https://…/proof.png"}'
```

1. `GET /api/payment/qr` picks the newest **LIVE** match that has a `qrCodeUrl`, else the next
   **UPCOMING** one; none is `404 NO_ACTIVE_QR`. Admins set that URL via `PATCH /api/admin/qr`.
2. `POST /api/payment/request` files a `PENDING` claim. `tokensToCredit` is frozen at
   `amount × TOKENS_PER_RUPEE` (1:1) so a later change to the ratio cannot silently move tokens
   from claims already filed. UTR references are canonicalised and unique platform-wide
   (`409 DUPLICATE_UTR`); more than five open claims is `429 TOO_MANY_PENDING`; `screenshotUrl`
   has to be an `https` URL on a host listed in `DOWNLOAD_ALLOW_HOSTS` (`http` only in development), and
   `data:` URLs are refused because no member is sending a base64 image to us.
3. `GET /api/admin/payments?status=PENDING` is the queue. `POST /api/admin/payments/:id/approve`
   writes the approval, `reviewedById`/`reviewedAt`, the `creditDeposit` movement and its
   `DEPOSIT` ledger row inside **one** `$transaction` — a half-approved claim is not reachable.
   `POST /api/admin/payments/:id/reject` requires a 3–500 character `reviewNote` and credits
   nothing. Only a `PENDING` claim can be reviewed (`409 NOT_PENDING`).
4. **There is no un-approve.** If an approval was wrong, credit the winning side manually and
   document it in the claim; the ledger is append-only by design (§5.5).

### Payout: member asks, tokens leave immediately

```bash
curl -s -X POST localhost:3000/api/withdrawal/request -H 'authorization: Bearer <token>' \
     -d '{"amount":400,"upiId":"name@okhdfcbank"}'
```

1. Filing debits `winningBalance` **at request time** through `debitWinning()`, so two pending
   requests can never spend the same tokens twice, and stores the `PENDING` row. `amount` is a
   positive integer ≤ `withdrawableBalance`, which is `winningBalance − 100`: **the wallet must
   retain 100 tokens**, and `debitWinning` refuses to be the thing that breaks that.
2. `GET /api/withdrawal/my` is the member's history. `GET /api/admin/withdrawals` is the queue.
3. `POST /api/admin/withdrawals/:id/approve` moves **no balance** — it only records that the
   transfer happened outside the system, with a `adminUtr` bank reference (8–32 chars, letters,
   digits, hyphens). `POST /:id/reject` refunds exactly what was debited, and the refund is
   verified against the original ledger row (`409 REFUND_NOT_MATCHED` if the amounts ever disagree)
   before a `RefundAdmin` is allowed to be trusted again. Reject also requires a note; it is the
   member's only explanation.

Wallet arithmetic lives in `src/lib/wallet.ts` and nowhere else: `tests/minimum-balance.test.ts`
fails the build if another module writes a balance column, if the 100 constant is re-declared, or
if a route reaches for `prisma.wallet.update`. That file is also where the retained-floor check now
sits inside `applyMovement` itself, so a future caller cannot drive a winning balance under 100.

## 4. Live scores

```bash
curl -s -X POST localhost:3000/api/admin/matches -d '{"title":"India vs Australia, 3rd T20I","teamA":"IND","teamB":"AUS","startTime":"2026-10-12T14:00:00Z"}'
curl -s -X PATCH localhost:3000/api/admin/matches/<id> -d '{"status":"LIVE"}'
curl -s -X POST localhost:3000/api/admin/matches/<id>/score \
     -d '{"teamAScore":"182/4","teamBScore":"96/2","currentOver":"16.3","expectedVersion":1}'
```

What the API will not let you do:

- **Shape.** Score strings are display text (`runs/wickets`, overs `<complete>.<balls>` with balls
  ≤ 5) validated for format only. There is no arithmetic on them, because cricket totals arrive as
  strings from wherever a human read them.
- **Monotonicity.** A total lower than the last one is refused (`409 SCORE_REVERSAL`) — the API has
  no concept of an innings restart. There is one `LiveScore` row per match and it is overwritten,
  so `version` proves ordering but not history: a scoreboard you typed wrong cannot be walked back
  through the API. Say so to whoever enters scores before launch (checklist item D).
- **Two writers at once.** Send the `version` you read as `expectedVersion`; a stale write is
  `409 SCORE_STALE` with the current version, so the poller can reconcile instead of overwriting.
- **After the result.** `COMPLETED` accepts updates from `SUPER_ADMIN` only.

Members read `GET /api/matches/live`, `GET /api/matches/:id` and `GET /api/matches/:id/score` — all
public, all `ETag` + short `Cache-Control` (`max-age=5` for a score, 15 for a list), and a score
response never carries `qrCodeUrl` or `externalId`. `PATCH /api/admin/matches/:id` is also how a
prediction window is reopened before the next score write.

The panel does not have the match, score-entry or QR pages yet — they are "soon" rows in its
sidebar, and until they exist these routes are the only way in. `npm run db:seed` with
`SEED_TEST_MATCH=1` creates a match for this endpoint set; `SEED_TEST_MATCH=live` also moves it to
`LIVE` and writes a `0/0`, over `0.0` scoreboard row so `GET /api/matches/:id/score` has something
to serve (that write locks prediction submissions, so `1` is the default).

## 5. Before you call it done

Work through `docs/TESTING_CHECKLIST.md`. The short version:

```bash
npm run verify
npm run build && PORT=3000 MONEY_MODE=on npm start   # then the live half of the checklist
TEST_BASE_URL=http://127.0.0.1:3000 npx vitest run tests/http-contract.test.ts
```

`tests/http-contract.test.ts` skips itself with a clear message when no server is listening, and a
run against a stale build proves nothing — rebuild before you restart. Its last two cases, the only
ones that prove a real session unlocks a real page, need a seeded staff account:

```bash
ADMIN_TEST_EMAIL=… ADMIN_TEST_PASSWORD=… TEST_BASE_URL=http://127.0.0.1:3000 \
  npx vitest run tests/http-contract.test.ts     # expect 83 passed, 0 skipped
```
