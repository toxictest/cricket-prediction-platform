import React, { type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "../theme/theme";

type Props = {
  children: ReactNode;
  /** Scrolls for you. Turn it off for a FlatList, which must be the scroller. */
  scroll?: boolean;
  padded?: boolean;
  /** Keeps the amount fields above the keyboard on Android and iOS. */
  keyboard?: boolean;
  refreshControl?: ReactNode;
  style?: object;
};

/**
 * Every screen in the app, so the background, the safe areas and the keyboard
 * behaviour are decided once. The `scroll={false}` path exists because a
 * `ScrollView` wrapped around a `FlatList` silently breaks both pull-to-refresh
 * and cell recycling.
 */
export function Screen({ children, scroll = true, padded = true, keyboard = false, refreshControl, style }: Props) {
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, padded && styles.padded, !keyboard && styles.flexy]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl as never}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flexy, style]}>{children}</View>
  );

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.root}>
      {keyboard ? (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flexy}>
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flexy: { flex: 1 },
  content: { flexGrow: 1, minHeight: "100%" },
  padded: { padding: spacing.lg, gap: spacing.lg },
});
