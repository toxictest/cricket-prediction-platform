# Testing checklist

A pass list for one release candidate, in the order that makes failures cheap: automated gate
first, then live HTTP against a built server, then the manual product flows, then security, then the
things nobody can test because they are not built.

**Do the money section against a scratch database**, not one real members use — the flows credit and
debit real rows, and there is no un-approve:

```bash
createdb cricket_platform_staging   # or: ./scripts/setup-dev-db.sh --reset
DATABASE_URL=postgresql://cricket:cricket_dev_password@localhost:5432/cricket_platform_staging?schema=public \
  npx prisma migrate deploy
DATABASE_URL=…cricket_platform_staging… npm run db:seed
```

---

## A. Automated gate — must be green before anything else

| # | Check | Command | Pass looks like |
| --- | --- | --- | --- |
| A1 | Types | `npm run typecheck` | no output, exit 0 |
| A2 | Lint | `npm run lint` | `✔ No ESLint warnings or errors` — the bar is zero, not "no errors" |
| A3 | Unit + service + route tests | `npm test` | every file passed; DB-backed files that skipped say why (`⚠ PostgreSQL unreachable`) |
| A4 | The whole gate | `npm run verify` | A1–A3 plus `npm run build` clean |
| A5 | Schema is honest | `npx prisma validate && git diff --exit-code prisma/` | valid, and nothing regenerated a migration |
| A6 | Secret hygiene | `git ls-files \| grep -E '^\.env$'` → nothing; `grep -rn "ADMIN_SESSION_SECRET=\"[A-Za-z0-9+/]\{20,\}" .env.example` → nothing | no real credential is tracked; `.env` stays untracked |

A3 is the layer that carries the real weight here: `tests/wallet.test.ts`, `tests/payment.test.ts`,
`tests/withdrawal.test.ts`, `tests/match.test.ts`, `tests/match-live.test.ts`,
`tests/admin-*.test.ts`, `tests/api-envelope.test.ts` (every route's guard + envelope),
`tests/minimum-balance.test.ts`, `tests/transaction-integrity.test.ts`, `tests/http-security.test.ts`
all hit the development PostgreSQL database by design, so **start Postgres before you claim the
suite passed** — a run where twelve files skipped themselves is not a pass.

## B. Live HTTP contract — needs a built server

```bash
npm run build
PORT=3000 MONEY_MODE=on npx next start -p 3000 &      # keep it alive
TEST_BASE_URL=http://127.0.0.1:3000 npx vitest run tests/http-contract.test.ts
```

| # | Check | Pass looks like |
| --- | --- | --- |
| B1 | `tests/http-contract.test.ts` | 83+ passed, 0 failed. If you see `skipped (no server at …)` the variable did not reach the test — that is a fail, not a pass |
| B2 | Never test a stale build | `npm run build` must be the last thing that touched `src/**` before the run |
| B3 | Health, and health under failure | up: `curl -s localhost:3000/api/health` → `{"ok":true,"data":{"status":"healthy","database":"connected",…}}`. With Postgres **stopped**: `/api/health` → `503 {"ok":false,"error":"Database unreachable","code":"INTERNAL_ERROR"}` and `/api/matches` → `500` JSON — the observed pair as of this commit. Both bodies and the server log must carry **no** stack trace, DSN or password |
| B4 | Undefined methods | `-X DELETE /api/wallet` → 405 with the security headers and an empty body (Next's own answer — acceptable), never an HTML error page. `/api/download` defines its own: `-X POST` → `405 {"ok":false,"error":"Method not allowed","code":"VALIDATION_ERROR"}` **plus** an `Allow` header naming GET; `tests/api-envelope.test.ts` requires `Allow` wherever a route defines a 405 |
| B5a | The signed-in half is not silently skipped | two panel checks only run with a seeded staff account: `ADMIN_TEST_EMAIL=… ADMIN_TEST_PASSWORD=… TEST_BASE_URL=… npx vitest run tests/http-contract.test.ts` → 83 passed, 0 skipped. `2 skipped` means those two did not run |
| B5 | Redirect escape hatch | `curl -si localhost:3000/api/download \| head -1` → member cookie + 307 → `Location: <APK_URL>`; guest → 401 JSON (this route returns no JSON body by design) |

## C. Member auth and session

| # | Check | Pass looks like |
| --- | --- | --- |
| C1 | Google sign-in creates the member | `/dashboard` → sign in → `GET /api/session` shows `isRegistered: true`, `token`, `user.referralCode` shaped `CRC-XXXXXX` |
| C2 | Wallet exists without asking | `GET /api/wallet` → `{"ok":true,"data":{"depositBalance":0,"winningBalance":0,"totalBalance":0,"withdrawableBalance":0,…}}` — never `WALLET_NOT_FOUND` for a freshly provisioned member |
| C3 | Second sign-in does not duplicate | sign out, sign in again → still exactly one `Wallet` row and one `User` row (the `getServerSession` bug that created shadow users is the regression to watch) |
| C4 | Referral link | `GET /api/referral` → `link`, `referralCode`, `referralCount`, `totalEarned`, `tier`; `GET /api/referral?limit=1` → 200; `?limit=999` → 400 `VALIDATION_ERROR` |
| C5 | Referral claims are not client-writable | no route accepts a referrer; `POST /api/qr/capture` is a no-op by design (returns 200 + explanation) |
| C6 | Guest isolation | with no cookie: `/dashboard`, `/me`, `/predict/[matchId]` render the login screen; `GET /api/me` → 401 `UNAUTHORIZED` |
| C7 | A dead session degrades cleanly | with an expired or tampered `cricket_session` cookie, `GET /api/me` → 401 JSON and `/dashboard` renders the login state — never a 500 page and never a half-rendered dashboard |

## D. Deposits and payouts (the money path)

| # | Check | Pass looks like |
| --- | --- | --- |
| D1 | Gate closed | restart without `MONEY_MODE` on a *production* build → `POST /api/payment/request` → `503 {"code":"PAYMENTS_DISABLED"}`; the panel shows the amber strip and disables every review button |
| D2 | QR published | admin `PATCH /api/admin/qr {"url":"https://…/qr.png"}` → member `GET /api/payment/qr` returns that fixture and **no** `qrCodeUrl` field name leakage into `/api/matches/*` |
| D3 | No fixture | with zero LIVE/UPCOMING matches carrying a QR → `404 NO_ACTIVE_QR`, message aimed at the member, not at a log |
| D4 | Claim filed | `POST /api/payment/request` → `{"ok":true,"data":{"payment":{…,"status":"PENDING","tokensToCredit":<amount>}}}`; amount `0`, `-5`, `1.5`, `>100000` → 400 |
| D5 | UTR dedupe | same `utrNumber` twice (two different members!) → second is `409 DUPLICATE_UTR` |
| D6 | Pending cap | a 6th open claim → `429 TOO_MANY_PENDING` |
| D7 | Proof URL rules | `http://` in production build → 400; `data:image/png;base64,…` → 400; host not in `DOWNLOAD_ALLOW_HOSTS` → 400 |
| D8 | Approve credits once | admin approve → member `GET /api/wallet` shows `depositBalance + amount`, and `GET /api/wallet/transactions` gained one `DEPOSIT` row whose `referenceId` is the claim id |
| D9 | Approve twice | second approve → `409 NOT_PENDING`; the balance did **not** move again |
| D10 | Reject | reject without `reviewNote` → 400; with one → status `REJECTED`, `reviewNote` visible to the member, wallet unchanged |
| D11 | Payout debits at filing | `POST /api/withdrawal/request {"amount":<n>,"upiId":"x@okhdfcbank"}` → `winningBalance` dropped by `n`, one `WINNING_DEBIT` ledger row, request `PENDING` |
| D12 | Floor | request that would leave < 100 → 400 `MINIMUM_BALANCE`, message exactly `Minimum 100 tokens must remain in wallet`; `withdrawableBalance` equals `winningBalance - 100` |
| D13 | Payout approve moves nothing | balance unchanged, `adminUtr`/`processedAt` set, status `APPROVED` |
| D14 | Payout reject refunds exactly | status `REJECTED`, `winningBalance` back to the pre-request number, a refund ledger row with the matching amount |
| D15 | Refund guard | a payout row whose debit is missing/tampered → `409 REFUND_NOT_MATCHED`, nothing credited |
| D16 | History | `GET /api/withdrawal/my` newest first, correct `status`, `amount`, `upiId` |
| D17 | Ledger never lies | after all of the above: for every member, `sum(Transaction.depositDelta)` = `Wallet.depositBalance` and the same for winnings (`tests/transaction-integrity.test.ts` runs this assertion; do it by hand for the member you clicked on) |

## E. Matches, predictions, live score

| # | Check | Pass looks like |
| --- | --- | --- |
| E1 | Fixtures | `GET /api/admin/matches` lists rows with `liveScore: true\|false`; `GET /api/matches?status=UPCOMING` filters |
| E2 | Score shape | `"182/4"` + `"16.3"` accepted; `"182-4"`, `"16.9"`, `16` (a number) → 400 with the exact field named |
| E3 | Monotonic | a lower total than the stored one → `409 SCORE_REVERSAL`. **And confirm the limitation:** the row is overwritten, so an erroneous score cannot be reverted through the API — only replaced with a higher one. This is a known gap, not a bug to fix mid-test |
| E4 | Concurrent writer | send `expectedVersion` of a version already superseded → `409 SCORE_STALE` + the current `version`; the stored row is untouched |
| E5 | Window closes on LIVE | once the match is `LIVE` **and** has a score row, a prediction POST is refused (`PREDICTION_CLOSED`); `PATCH {"predictionsOpen":true}` (super) reopens it for the next write |
| E6 | Completed lock | `COMPLETED` + a `SCORE_ADMIN` writer → `409 MATCH_COMPLETED`; a `SUPER_ADMIN` may still correct it |
| E7 | Member polling | `GET /api/matches/:id/score` → `ETag`, `Cache-Control: public, max-age=5…`; re-send with `If-None-Match` → `304` with an empty body; `lastUpdatedBy`/`lastUpdatedById` absent from the payload |
| E8 | Nothing leaks | no `/api/matches*` response contains `qrCodeUrl` or `externalId` |
| E9 | 404 is JSON | `GET /api/matches/does-not-exist` → `404 {"ok":false,"code":"NOT_FOUND",…}`; `GET /api/matches/CMV3AAA/score` on an unknown id → same |
| E10 | Panel score entry | **not built** — the sidebar row says "soon". Do not file a bug; use the API (§4 of `DEVELOPMENT.md`) |

## F. Admin panel (UI increment 1)

| # | Check | Pass looks like |
| --- | --- | --- |
| F1 | Login page | `/admin/login` renders the dark theme, no member nav; wrong password → toast + no cookie; locked account → message naming the remaining minutes |
| F2 | Guarded panel | `/admin/dashboard` with no cookie → 307 to `/admin/login`; with a cookie whose `adminSessionVersion` was bumped → back to login |
| F3 | Role-based nav | a `SUPPORT_ADMIN` sees the dashboard and no review queues; `PAYMENT_ADMIN` sees payments + payouts; `SCORE_ADMIN` sees matches + QR |
| F4 | Queue actions | approve opens a dialog, needs a click on the confirm button, then: row leaves the pending list, counter drops, success toast names the amount |
| F5 | Failure handling | reject a row another admin already reviewed → error toast with `NOT_PENDING`, the table refetches and the row disappears |
| F6 | Money gate in UI | with the gate closed every action button is disabled *and* the strip explains why (not a silent no-op) |
| F7 | Mobile | at 375px the table scrolls horizontally, the dialog fits, no horizontal page scroll |
| F8 | Logout | cookie cleared, `adminSessionVersion` incremented, `/admin/dashboard` → login |

## G. Security sweep

| # | Check | Pass looks like |
| --- | --- | --- |
| G1 | Member token cannot pass as staff | send the member's own session cookie to an admin route (any request through the member flow carries `cricket_session`) → `401 UNAUTHENTICATED`, because the admin verifier requires the staff JWT claim. Production cookie is `__Host-cpc_admin_session` (Secure + httpOnly + SameSite=Strict); development drops the `__Host-` prefix because the dev origin is http |
| G2 | Every admin route guarded | `tests/admin-route-coverage.test.ts` walks the file tree, not a hand-kept list: each `src/app/api/admin/**` handler calls `requireAdmin` with an explicit role array and returns `adminErrorResponse` on failure |
| G3 | One response envelope | `tests/api-envelope.test.ts` — no route hand-builds `{ok:false}`, no `NextResponse.json` in a route file, every exported handler wrapped in `guardRoute`, so a thrown error is JSON `500` and never an HTML crash page |
| G4 | No secret echoes | for each error path, grep the response body and the server log for the DSN password, the bcrypt hash, the JWT: none present (`redactSecrets` covers `password`, `token`, `secret`, `authorization`, `screenshotUrl` → `[redacted]`) |
| G5 | Rate limits present | a member hammering `POST /api/referral/capture` hits `429` + `Retry-After`; admin login failures lock after the configured attempts |
| G6 | Static mirror gated | `/api/download` refuses guests (401 JSON) rather than serving the APK |
| G7 | Upload surface | there is no upload route, so `screenshotUrl` must stay an *external* URL — confirm the app does not accept `data:` or write files into `storage/` |
| G8 | SQL/API injection | `?status=LIVE); DROP TABLE` → 400 `VALIDATION_ERROR`, not 500; `curl` a 100 KB body → 413 |
| G9 | Session cookie scope | the member cookie name/flags match what `/api/session` expects; no `Set-Cookie` appears on `/api/health` |

## H. Things that are known gaps — verify they are *documented*, not that they work

- No un-approve for an approved deposit; recovery is a manual ledger entry (§5.5).
- Score rows are overwritten: no score history, no revert.
- No payment-provider ingest, no webhook — the ` utrNumber` is typed by a human.
- No `DELETE` for matches, no `CANCELED` status, no upload endpoint.
- Panel pages 4–7 (payouts, matches, score entry, QR) are "soon"; `/api/qr/capture` is a no-op.
- Legal/DPDP posture is still open (README §4.7 + §15.1) — a launch blocker, not a test failure.

## I. Sign-off

```
build sha: ____________   database: ____________   MONEY_MODE: on | off
A1–A6 green?  Y / N (paste the last line of `npm run verify`)
B1 passed?    Y / N        (files: ____  skipped: ____)
D1–D17        Y / N        (N item numbers: ______________)
E1–E9         Y / N        (N item numbers: ______________)
F1–F8         Y / N        (N item numbers: ______________)
G1–G9         Y / N        (N item numbers: ______________)
tester: ____________________  date: ____________
```

Anything marked N becomes either a fix or an entry in §H with a reason. "Skipped" is never a pass.
