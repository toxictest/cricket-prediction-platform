# storage/apk

Private staging directory for release builds.

Files placed here are **not** served by the web server. They are read by
`GET /api/download` (see `src/lib/artifact.ts`), which enforces the member
session *before* streaming a single byte.

This location is probed **first**, ahead of `public/downloads/`, so a real
build dropped here automatically shadows the committed demo placeholder.

```bash
cp ~/android/app/build/outputs/apk/release/app-release.apk storage/apk/
```

`.gitignore` excludes `storage/apk/*.apk` so release binaries and signing
outputs never reach version control.
