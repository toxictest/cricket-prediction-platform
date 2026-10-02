#!/usr/bin/env node
/**
 * ============================================================================
 * make-placeholder-apk.mjs
 * ============================================================================
 * Writes a DEMO artifact to `public/downloads/app-release.apk` so the whole
 * download journey (middleware gate → session check → audit log → byte stream)
 * can be exercised end to end before the real build exists.
 *
 * An `.apk` is a ZIP archive, so we emit a valid, uncompressed ZIP container
 * holding:
 *   - README.txt      → what this file is and how to replace it
 *   - BUILD_INFO.json → version + metadata mirroring `lib/constants.ts`
 *   - NOT_AN_INSTALLABLE_BUILD.txt → unambiguous notice
 *
 * This file is NOT installable on Android. Replace it with the real signed
 * build before going to production:
 *
 *   cp ~/android/app/build/outputs/apk/release/app-release.apk \
 *      public/downloads/app-release.apk
 *
 * Usage:  node scripts/make-placeholder-apk.mjs
 * ============================================================================
 */

import { createHash } from "node:crypto";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const OUT_DIR = join(ROOT, "public", "downloads");
const OUT_FILE = join(OUT_DIR, "app-release.apk");

const VERSION = process.env.APK_VERSION ?? "1.0.0";

/* ---------------------------------------------------------------------------
   CRC-32 (needed by the ZIP local/central headers)
   --------------------------------------------------------------------------- */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ---------------------------------------------------------------------------
   Minimal ZIP writer (deflate, no data descriptors).
   --------------------------------------------------------------------------- */
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(entry.data, "utf8");
    const deflated = deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const method = 8; // deflate

    // ---- local file header ----
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0x2821, 10); // mod time (2026-01-01 04:04)
    local.writeUInt16LE(0x5a41, 12); // mod date (2026-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, deflated);

    // ---- central directory entry ----
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); // signature
    dir.writeUInt16LE(20, 4); // version made by
    dir.writeUInt16LE(20, 6); // version needed
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(0x2821, 12);
    dir.writeUInt16LE(0x5a41, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(deflated.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30); // extra length
    dir.writeUInt16LE(0, 32); // comment length
    dir.writeUInt16LE(0, 34); // disk number
    dir.writeUInt16LE(0, 36); // internal attrs
    dir.writeUInt32LE(0, 38); // external attrs
    dir.writeUInt32LE(offset, 42);

    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + deflated.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, end]);
}

/* ---------------------------------------------------------------------------
   Payload
   --------------------------------------------------------------------------- */
const README = `CRICKET PREDICTION COMMUNITY — ANDROID TERMINAL
==============================================

THIS IS A DEMO PLACEHOLDER ARTIFACT. IT IS NOT AN INSTALLABLE ANDROID APP.

It exists so the Download Center can be tested end to end: the route gate,
the database audit log, the byte stream and the browser save dialog all behave
exactly as they will with the real build.

Version   : ${VERSION}
Platform  : android
Package   : com.cricketprediction.terminal
Generated : ${new Date().toISOString()}

--------------------------------------------
REPLACING THIS FILE WITH A REAL BUILD
--------------------------------------------
1. Build the signed release APK in Android Studio:
     ./gradlew assembleRelease

2. Copy it over this placeholder (either location works):
     cp app/build/outputs/apk/release/app-release.apk \\
        public/downloads/app-release.apk

   Or keep binaries out of version control and use the private staging dir:
     mkdir -p storage/apk
     cp app-release.apk storage/apk/app-release.apk

   The /api/download route probes storage/apk first, then public/downloads.

3. Point at an external CDN instead by setting:
     NEXT_PUBLIC_APK_DOWNLOAD_URL="https://cdn.example.com/app-release.apk"

4. Refresh the checksum shown on the Download Center page.

--------------------------------------------
SECURITY NOTES
--------------------------------------------
* Never commit real signing keys or release binaries to git.
* Verify the SHA-256 shown in the UI against the artifact you serve.
* Content-Type is forced to application/vnd.android.package-archive and the
  response is marked no-store so proxies never cache a stale build.
`;

const BUILD_INFO = JSON.stringify(
  {
    placeholder: true,
    installable: false,
    generatedAt: new Date().toISOString(),
    app: {
      name: "Cricket Prediction Community — Android Terminal",
      package: "com.cricketprediction.terminal",
      version: VERSION,
      buildNumber: "1042",
      minSdk: 26,
      targetSdk: 35,
      architectures: ["arm64-v8a", "armeabi-v7a"],
    },
    distribution: {
      channel: "members-only",
      endpoint: "/api/download",
      requiresAuthentication: true,
    },
  },
  null,
  2,
);

const NOTICE = `This archive was generated by scripts/make-placeholder-apk.mjs.
It contains no DEX bytecode, no resources.arsc and no AndroidManifest.xml.
Android will reject it. Replace it with a real signed release build.
`;

/* ---------------------------------------------------------------------------
   Write
   --------------------------------------------------------------------------- */
const zip = buildZip([
  { name: "README.txt", data: README },
  { name: "BUILD_INFO.json", data: BUILD_INFO },
  { name: "NOT_AN_INSTALLABLE_BUILD.txt", data: NOTICE },
]);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, zip);

const size = statSync(OUT_FILE).size;
const sha256 = createHash("sha256").update(zip).digest("hex");

console.log("✔ placeholder APK written");
console.log(`  path   : ${OUT_FILE}`);
console.log(`  bytes  : ${size}`);
console.log(`  sha256 : ${sha256}`);
console.log("");
console.log("  Reminder: this artifact is NOT installable on Android.");
