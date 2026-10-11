# Cricket Predict — member app (Expo / React Native)

The end-user app, living in `mobile/` inside [the platform repository](../README.md): sign in,
follow matches and live scores, add money with a UPI QR, request a payout, read the wallet
ledger. Members only — nothing in this codebase can create an admin, approve a payment, or
move a token by itself.

Expo SDK 57 (React Native 0.86), TypeScript strict, Expo Router file-based routing, Axios,
 AsyncStorage, React Native Paper (dark theme), `expo-image-picker`.

---

## 1. Layout

```
app/
  _layout.tsx                     providers, Paper theme, native-stack header
  login.tsx                       public: Google / handoff / dev token
  (protected)/
    _layout.tsx                   auth gate — redirects to /login when signed out
    (tabs)/_layout.tsx            custom tab bar (no icon package)
    (tabs)/index.tsx              home: Upcoming · Live · Completed, paged tabs
    (tabs)/wallet.tsx             three balances + the three actions
    (tabs)/profile.tsx            identity, referral code, sign out
    match/[id].tsx                match detail + live score (ETag poll)
    wallet/add-money.tsx          QR → amount → UTR → screenshot → claim
    wallet/withdraw.tsx           amount + UPI id, confirm dialog, request history
    wallet/transactions.tsx       the ledger
src/
  lib/        config, storage (AsyncStorage), api (axios + bearer), pkce
  services/   auth · matches · wallet · payments · withdrawals · uploads
  state/      AuthContext, WalletContext
  components/ Screen, Panel, Field, Notice, StatusPill, BalanceTile, ListFooter, …
  hooks/      usePoll (interval refresh + backoff, ETag-aware)
  utils/      format, labels (every enum label lives here)
  types/api.ts                  mirrors the backend's public contract
```

Rules that survive the whole tree:

- **The backend decides everything about money.** Amounts, caps, uniqueness, minimums and
  balances are checked client-side only so a mistake is visible before a request is sent.
- **A server error is shown verbatim.** No rewrite into friendlier words. `toUiError()`
  returns the payload's message and code unchanged, so what a member reads is what an admin
  wrote, and the copy cannot drift from the API.
- **Unknown enum values render raw.** Every label map falls back to the value itself, so a
  status added server-side shows up instead of blanking the row.

## 2. Setup

```bash
npm install --legacy-peer-deps     # bare `npm install` fails: react-dom 19.3 vs react 19.2
cp .env.example .env               # then set EXPO_PUBLIC_API_URL
npx expo start                     # press a / i, or scan the QR with Expo Go
npm run typecheck                  # tsc --noEmit — the gate used in this repo
```

`--legacy-peer-deps` is needed because `react-native-web@0.21` pulls `react-dom@19.3.0` while
the template pins `react@19.2.3`. It is a peer-range disagreement in the Expo template, not
in this app; drop the flag once the template pins matching versions.

### Pointing it at a LAN dev server

`EXPO_PUBLIC_API_URL` is a build-time literal, which is right for a deployed app and awkward for a
phone: a laptop's LAN IP changes with the Wi-Fi, and rebuilding an APK to follow it is a five-minute
punishment for a typo. So a build whose compiled URL is plain http — i.e. a development build — shows
a **Server address** panel on the sign-in screen: type the address, press *Test* (it calls
`GET /api/health`, which answers without a session, so it distinguishes "the phone cannot reach that
host" from "reachable, but its database is down"), then *Use this address*. The override lives in
AsyncStorage on that device and is re-read before the first request on every launch.

It is deliberately invisible when the compiled URL is https. A field that can repoint the app at
another host must never appear in a build members download, and the only place it can be edited at
all is the sign-in screen, where by definition you are not yet carrying a session to leak.

Release builds refuse cleartext http outright (Android's own policy, which Expo keeps), so a LAN test
over http needs a debug build — or an https tunnel.

### What the backend needs

| Env var | Why |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | `/api/auth/mobile` + the browser handoff |
| `MEMBER_TOKEN_SECRET` | signs member tokens (falls back to `NEXTAUTH_SECRET`; ≥ 32 chars either way) |
| `MONEY_MODE` | `off` hides the money endpoints entirely (503 `PAYMENTS_DISABLED`); `audit`/`on` accept claims. The app renders the 503 as-is — that is a deliberate configuration, not a bug. |
| `NEXTAUTH_URL` | origin allow-list for screenshot URLs |

## 3. Login

`POST /api/auth/mobile` accepts exactly one of three proofs and returns a bearer token held
for 30 days in AsyncStorage. The three routes into it, in the order the login screen offers:

1. **Google id token** — if you later add `expo-auth-session`, the Google access token goes
   straight to the same endpoint. No broker.
2. **Browser handoff** (what ships today) — the app opens `GET /mobile/start?challenge=…` in
   the browser, the member signs in with Google there, and the backend 302s to
   `cricketmobile://auth?code=…`. The code is a 120-second, single-use, audience-bound JWT;
   the app swaps it for the real token along with the PKCE verifier it generated before
   opening the browser. The token never passes through a web session, and the deep-link scheme
   comes from `scheme: "cricketmobile"` in `app.config.ts`.
3. **Dev token** — a bearer pasted by hand, or printed from the repository root with
   `npm run mobile:token -- member@example.com`. Refused in production by the server.

Auto-login: on launch `bootstrap()` reads the stored token, calls `GET /api/me`, and only then
resolves. A `GET /api/session` probe would not work — that route is cookie-only. The axios
interceptor reads the token from AsyncStorage per request instead of from React state, which
is what avoids a race during the first second after launch.

## 4. Live score

`GET /api/matches/[id]/score` answers `{ match, score }`; `batsmanStats` / `bowlerStats` are
admin-entered JSON, so the stats table is driven by whichever keys are actually present and
renders nothing rather than guessing. The request carries `If-None-Match`, a `304` returns the
previous payload, and the poll interval comes from the payload's own `pollAfterMs` (clamped to
≥ 5 s by the API). A finished or abandoned match stops polling, and the interval is held in
separate state on purpose: a hook cannot read its own output.

## 5. Money

- **Add money** — `GET /api/payment/qr` gives the static UPI QR (`NO_ACTIVE_QR` when none is
  configured, and the reason the app has no built-in fallback image). The claim form is
  amount + UTR + screenshot. UTR uniqueness and `MAX_PENDING_PER_MEMBER` are the server's;
  its `DUPLICATE_UTR` / `TOO_MANY_PENDING` answers are shown verbatim.
- **Screenshot upload does not exist on the backend yet.** The backend accepts only a
  `screenshotUrl` that is https and whose host it trusts. So `EXPO_PUBLIC_UPLOAD_URL` is
  optional: without it the chosen image previews on-device and the claim is filed without
  proof. Setting `expo-image-picker` aside for an upload endpoint is a one-file change in
  `src/services/uploads.ts`.
- **Withdraw** — winnings only; `depositBalance` is never debited. Filing the request debits
  immediately (that is what stops one balance being spent twice), and the screen says so. The
  floor is "Minimum 100 tokens must remain in wallet", enforced in the SQL writer; the client
  preview uses the same sentence from the same constants file.
- **Ledger** — `GET /api/wallet/transactions` accepts only `limit` and `cursor`, so the screen
  has no type filter: inventing one in the UI would silently do nothing. A pending claim is
  not a ledger row.

## 6. Building an APK

Two routes. Both need the env vars baked in at build time — Expo reads `.env` when the bundle
is made, and `EXPO_PUBLIC_*` values are literals in the JS, so changing a URL means rebuilding.

### A. EAS Build (cloud, no Android SDK needed)

```bash
npm i -g eas-cli && eas login            # an Expo account, free tier is enough
eas build:configure                      # writes eas.json (already present here)
eas build -p android --profile preview   # ← an installable .apk
eas build -p android --profile production  # .aab for Play Store upload
```

`eas.json` has three profiles: `development` (Expo Go-style dev client), `preview`
(**`buildType: "apk"`** — this is the one you want to sideload), and `production` (`.aab`).
`preview` builds a release binary, so it must be pointed at an **https** API URL — release
builds cannot use cleartext http.

Add the build number/versioning to EAS's hands with `eas build:version:set` once, and
`eas secret:create --name EXPO_PUBLIC_API_URL --value https://your-domain.app` if you would
rather keep the URL out of the repo. Download finishes with a URL printed by the CLI; install
with `adb install -r CricketPredict.apk` or copy it to the phone.

First build generates and stores signing material in your Expo account. If you want your own
keystore instead: `keytool -genkeypair -v -keystore cricket.keystore -alias cricket -keyalg RSA -keysize 2048 -validity 10000`,
then `eas secret:create --scope project --name ANDROID_KEYSTORE_BASE64 --value "$(base64 -w0 cricket.keystore)"`
plus `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEYALIAS` / `ANDROID_KEYALIAS_PASSWORD`.
`*.keystore` and `*.jks` are git-ignored for that reason.

### B. Locally, no EAS account

```bash
export EXPO_PUBLIC_API_URL=https://your-domain.app
npx expo prebuild --platform android --clean     # generates ./android (git-ignored)
cd android && ./gradlew assembleRelease          # APK in android/app/outputs/apk/release/
```

Needs JDK 17 and the Android SDK (`ANDROID_HOME`). For a quick device build during
development: `npx expo run:android`, which prebuilds, builds a *debug* APK, installs it on the
connected device and starts the dev server — that is the one where a LAN `http://192.168.x.x:3000`
URL works, because debug builds allow cleartext.

### What a local build actually needed

The first real build was made here, on a machine with 2 GB of RAM and 2 cores, and that is worth
recording because the failure modes are not obvious:

| Needed | Why |
| --- | --- |
| ~5 GB of swap | `clang++` on React Native's C++ with `-g` is a several-hundred-MB process; without headroom it swaps until the box stops responding to *everything*, not just Gradle. |
| `-PreactNativeArchitectures=arm64-v8a` | One ABI instead of four. A phone is arm64; the x86_64 pass is only worth it for an emulator run. |
| `--no-daemon`, `-Dorg.gradle.workers.max=1`, `-Dorg.gradle.parallel=false` | The daemon was holding ~1 GB that the compiler needed. |
| `-DCMAKE_CXX_FLAGS_RELWITHDEBINFO=-O2 -g0 -DNDEBUG` in `android/app/build.gradle` | Drops debug info from the native objects. The APK strips those symbols anyway, and it roughly halves peak memory. `android/` is generated and git-ignored, so this is a local-build note, not a repo change. |
| `-Pandroid.r8.maxWorkers=1`, and a heap ≥ 1.2 GB | 768 MB was too small for D8 (`D8: java.lang.OutOfMemoryError: Java heap space`); 1536 MB with everything else off got the JVM OOM-killed during packaging instead. |
| nothing else | Everything above is the story of one command: `./gradlew assembleRelease`. |

The permission set in the artifact is trimmed by `plugins/with-permission-trim.js`, and that plugin is
**last in the `plugins` array on purpose**: config plugins apply in order, so placed before
`expo-image-picker` its edits were overwritten and the merged manifest still asked for a microphone.
Filtering `android:uses-permission` would also have done nothing — the element is `uses-permission`
with `android:` only on the *attributes* — and it has to emit `tools:node="remove"` rather than delete
entries, because the merger re-adds whatever an AAR declares. Checked on the built file:

```bash
$ aapt2 dump badging app-release.apk | grep uses-permission
uses-permission: name='android.permission.INTERNET'
uses-permission: name='android.permission.READ_EXTERNAL_STORAGE' maxSdkVersion='32'
uses-permission: name='android.permission.VIBRATE'
uses-permission: name='com.cricketprediction.mobile.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'
uses-permission: name='com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE'
```

### The build that was made here

`app-release.apk`, 38,459,023 bytes, from this source at this commit — `arm64-v8a` only, minSdk 24,
targetSdk 36, `assets/index.android.bundle` (2.6 MB of Hermes-compiled JS) inside it, so it does not
need a dev server. `EXPO_PUBLIC_API_URL` was compiled as `http://192.168.1.20:3000`, and the sign-in
screen offers the address editor for exactly that reason.

It is signed with `CN=Android Debug` — the keystore `expo prebuild` generates, which is what the bare
template uses for `release` too. Consequences, in order of how much they matter: it is a **test**
APK, installable by sideloading and nothing else; it cannot be uploaded to Play; and installing an
update signed with a different key requires uninstalling first. For a store build, generate a real
keystore, keep it, and use `eas build -p android --profile production`.

## 7. Troubleshooting

| Symptom | What it actually is |
| --- | --- |
| `Authorization rejected` on every call | Token expired (30 days) or `MEMBER_TOKEN_SECRET` changed on the server. Sign out, sign in. |
| Empty list, no error, on a real device | The app is on the phone and the API on `localhost` — localhost is the phone itself. Use the LAN IP, or `http://10.0.2.2:3000` on an Android emulator. |
| `Network request failed` on an APK over http | Release builds block cleartext by design. Use https. |
| `No payment QR is configured` | Expected until an admin uploads one at `/admin/qr`. |
| Money actions answered with 503 | `MONEY_MODE=off`. The endpoints are wired and documented; they are gated on counsel's approval. |
| Login returns `AUTH_NOT_CONFIGURED` | No `GOOGLE_CLIENT_ID`/`SECRET` on the backend. Use the dev-token field to get in. |
| `Cannot find module 'expo-router/entry'` | `package.json` → `"main"` must stay `"expo-router/entry"`. |
| `Gradle build daemon disappeared unexpectedly` during packaging | Not a code error: the kernel OOM-killed the JVM. See §6 for the flags that fit a 2 GB machine. |
| `expo prebuild` aborts on a missing `adaptive-icon.png` | SDK 57's template ships three adaptive-icon layers; pointing `adaptiveIcon` at a file that is not there fails the icon pass. See `app.config.ts`. |

## 8. Conventions worth keeping

- One query per `Panel`, one component per row of a list. A screen is data + layout, not both.
- `services/` owns the wire format: the query string, the envelope unwrap, the error code.
  A screen never builds a URL.
- Money is an integer token count end to end; `formatIndian` only adds the separators.
- No clipboard permission: the referral link is shared through the OS share sheet.
- `npm run typecheck` is the only gate in this repo; the backend's http-contract tests are what
  prove the shapes this app codes against.
