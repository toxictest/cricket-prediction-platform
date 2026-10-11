import React from "react";
import { StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { PaperProvider } from "react-native-paper";
import { ActivityIndicator } from "react-native-paper";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../src/state/auth";
import { WalletProvider } from "../src/state/wallet";
import { colors, paperTheme } from "../src/theme/theme";

/*
 * The whole app in four providers, in the order that matters:
 *
 *   SafeArea → Auth → Wallet → Paper
 *
 * Wallet sits inside Auth because it seeds itself from the sign-in snapshot and
 * has to stop being populated the moment Auth drops the session. Paper sits
 * outermost so every dialog renders against the dark theme, including the ones
 * rendered by Auth's own error states.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider style={styles.root}>
      <StatusBar style="light" />
      <AuthProvider>
        <WalletProvider>
          <PaperProvider theme={paperTheme}>
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.surface },
                headerTintColor: colors.text,
                headerTitleStyle: { color: colors.text, fontWeight: "700" },
                headerShadowVisible: false,
                contentStyle: { backgroundColor: colors.background },
              }}
            >
              <Stack.Screen name="login" options={{ headerShown: false }} />
              <Stack.Screen name="(protected)" options={{ headerShown: false }} />
            </Stack>
            <BootSplash />
          </PaperProvider>
        </WalletProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

/**
 * Rendered on top of the first frame while the stored token is being checked.
 *
 * It is a screen, not a spinner in each page, because a half-painted wallet is the
 * worst possible thing to show a member: the number below it could be from
 * yesterday. `expo-splash-screen` can hold the native splash longer; that is the
 * production polish, and this is the version that never shows a lie.
 */
function BootSplash() {
  const [visible, setVisible] = React.useState(true);

  React.useEffect(() => {
    const id = setTimeout(() => setVisible(false), 1200);
    return () => clearTimeout(id);
  }, []);

  if (!visible) return null;

  return (
    <View style={styles.splash} pointerEvents="none">
      <View style={styles.mark}>
        <ActivityIndicator color={colors.cyan} />
        <View style={styles.wordmark}>
          <View style={styles.dot} />
          <View style={styles.dot} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  splash: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  mark: { gap: 18, alignItems: "center" },
  wordmark: { flexDirection: "row", gap: 6 },
  dot: { width: 26, height: 3, borderRadius: 2, backgroundColor: colors.cyan },
});
