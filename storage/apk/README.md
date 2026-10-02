# Private APK staging

Drop the signed release here:

```
storage/apk/app-release.apk
```

This directory is **not** web-served. The file is streamed by the guarded
`/api/download` route, which authenticates the member, writes an audit row and
counts the download before a single byte leaves the server.

## Optional label

Add `release.json` next to the binary to describe the build:

```json
{
  "packageName": "com.yourcompany.cricketterminal",
  "versionName": "1.0.0",
  "buildNumber": "1",
  "minAndroid": "8.0 (Oreo / API 26)",
  "architecture": "arm64-v8a, armeabi-v7a",
  "releasedAt": "2026-10-02",
  "notes": "First signed release."
}
```

Copy `release.example.json` as a starting point.

**Only descriptive fields are read from this file.** Size, SHA-256 and — unless
overridden — the release date are measured from the APK itself, so the checksum
published on the Download Center always matches the bytes a member receives.
A malformed or absent `release.json` is not an error; missing fields simply
render as `not set`.

## Why not `public/`?

Anything under `public/` is served directly by the CDN. Put an APK there and
anyone who guesses the filename gets it without a session, which defeats the
registration gate entirely. `storage/apk/` is only reachable through the
authenticated route.

## This directory ships empty

The repository contains no APK. Until a build is staged, `/download` renders an
explicit "No build staged on this server" panel and `/api/download` returns
`503 BUILD_UNAVAILABLE` for authenticated members. Nothing about a release is
invented to fill the gap.
