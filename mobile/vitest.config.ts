import { defineConfig } from "vitest/config";

/*
 * The app's own test run: pure logic only, node environment, no React Native runtime.
 *
 * Screens are not unit-tested here — that would need a renderer, and the honest value of a
 * test in a client this size is in the rules it mirrors, not the pixels. So the include list
 * is the `src/` tree, and anything that needs `react-native` should be an integration check
 * on a device instead of a mocked one here.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "app/**/*.test.ts"],
    exclude: ["node_modules/**", "android/**", "ios/**", "dist/**"],
  },
});
