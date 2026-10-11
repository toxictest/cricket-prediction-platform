import type { ConfigContext, ExpoConfig } from "expo/config";

/*
 * App config, as code rather than app.json, so the parts that differ between a dev
 * build and a shipped one can be computed instead of hand-edited.
 *
 * Plain http on Android is the one that matters, and nothing is set for it here on
 * purpose: Expo already allows cleartext in debug builds and blocks it in release
 * builds. Setting `usesCleartextTraffic` at this level is how that allowance ends up
 * in a shipped APK. If a test build genuinely needs it, add the `expo-build-properties`
 * plugin to that build profile rather than editing this file.
 */

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Cricket Predict",
  slug: "cricket-mobile",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  scheme: "cricketmobile",
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.cricketprediction.mobile",
    // Where the browser hands the signed-in session back (see README §Login).
    infoPlist: { CFBundleURLTypes: [{ CFBundleURLSchemes: ["cricketmobile"] }] },
  },
  android: {
    package: "com.cricketprediction.mobile",
    // The three layers the Expo template actually ships. `backgroundColor` was the
    // old single-layer form; SDK 57 wants the background as an image so the monochrome
    // layer can be recoloured by Android's themed-icon pass.
    adaptiveIcon: {
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: false,
        data: [{ scheme: "cricketmobile" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    favicon: "./assets/favicon.png",
    bundler: "metro",
  },
  plugins: [
    "expo-router",
    [
      "expo-image-picker",
      {
        // Only photos are read, never the camera: proof of payment is screenshotted,
        // not photographed, and asking for the camera here would be an unused permission.
        photosPermissionMessage: "Your gallery is used to pick a screenshot of the UPI payment.",
        cameraPermission: false,
      },
    ],
    // Last on purpose. Config plugins apply in array order, and this one has to run after the
    // library plugins that add the permissions it removes — placed before them, its edits are
    // simply overwritten and the merged manifest keeps asking for a microphone.
    "./plugins/with-permission-trim",
  ],
  experiments: {
    reactCompiler: false,
  },
});
