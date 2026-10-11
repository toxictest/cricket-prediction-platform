import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme/theme";

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.wrap}>
      <ActivityIndicator color={colors.cyan} />
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

export function LoadingRow() {
  return (
    <View style={styles.rowWrap}>
      <ActivityIndicator color={colors.cyan} size="small" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: spacing.xxl, alignItems: "center", gap: spacing.md },
  label: { color: colors.textMuted, fontSize: 13 },
  rowWrap: { paddingVertical: spacing.md, alignItems: "center" },
});
