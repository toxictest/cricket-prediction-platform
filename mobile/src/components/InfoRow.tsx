import React, { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme/theme";

type Props = { label: string; value: ReactNode; mono?: boolean };

/** Label left, value right — the row shape used by profile, wallet and receipt panels. */
export function InfoRow({ label, value, mono }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      {typeof value === "string" ? (
        <Text style={[styles.value, mono && styles.mono]} numberOfLines={2}>
          {value}
        </Text>
      ) : (
        <View style={styles.valueBox}>{value}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  label: { color: colors.textMuted, fontSize: 13, flexShrink: 1 },
  value: { color: colors.text, fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right", flex: 1 },
  valueBox: { flex: 1, alignItems: "flex-end" },
  mono: { fontVariant: ["tabular-nums"], letterSpacing: 0.2 },
});
