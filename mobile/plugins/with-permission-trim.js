const { withAndroidManifest } = require("@expo/config-plugins");

/*
 * Take back the permissions the merged manifest picks up from libraries we do not use the
 * way their authors did.
 *
 * Android's manifest merger adds whatever an AAR declares, and React Native libraries declare
 * generously: `expo-image-picker` brings the storage and camera-adjacent permissions for a
 * capture flow we do not run (we read a screenshot out of the gallery), and the dev-launcher
 * machinery brings `SYSTEM_ALERT_WINDOW` so a red-screen dialog can be drawn over other apps.
 * None of that is this app's behaviour, and a prediction app asking to record audio is exactly
 * the detail that costs trust in a store listing and in a lawyer's review.
 *
 * Filtering the app's own list would not be enough: the merger would re-add the library's entry
 * on the next build, which is the kind of thing that silently returns when a dependency is
 * bumped. So each unwanted permission is declared here with `tools:node="remove"`, which is the
 * merger's own instruction to drop it wherever it comes from — ours or a library's.
 *
 * If a permission on this list ever becomes genuinely needed, that is a deliberate edit: remove
 * it from the set below, and the merged manifest will ask for it again.
 */
const REMOVE = new Set([
  "android.permission.RECORD_AUDIO",
  "android.permission.CAMERA",
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.MODIFY_AUDIO_SETTINGS",
]);

const TOOLS_NS = "http://schemas.android.com/tools";

module.exports = function withPermissionTrim(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    manifest.$ = manifest.$ || {};
    manifest.$["xmlns:tools"] = TOOLS_NS;

    // The element carries no namespace prefix of its own — `<uses-permission android:name=…>` —
    // so in the parsed object the key is `uses-permission` while the *attribute* keeps its
    // `android:` prefix. Filtering `android:uses-permission` here reads nothing and then writes a
    // literal `<android:uses-permission>` element, which the merger ignores. That mistake is what
    // this comment exists for.
    const edit = (key) => {
      const existing = Array.isArray(manifest[key]) ? manifest[key] : manifest[key] ? [manifest[key]] : [];
      const kept = existing.filter(
        (entry) => !REMOVE.has((entry && entry.$ && entry.$["android:name"]) || ""),
      );
      const removals = [...REMOVE].map((name) => ({
        $: { "android:name": name, "tools:node": "remove" },
      }));
      manifest[key] = [...kept, ...removals];
    };

    edit("uses-permission");
    // The other syntax some libraries use, for permissions that only apply from API 23 up.
    edit("uses-permission-sdk-23");
    return cfg;
  });
};
