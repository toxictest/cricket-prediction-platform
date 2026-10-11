import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme/theme";

type Props = {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "deposit" | "winning" | "muted" | "danger" | "success";
};

const toneColors: Record<NonNullable<Props["tone"]>, string> = {
  default: colors.text,
  deposit: colors.deposit,
  winning: colors.winning,
  muted: colors.textMuted,
  danger: colors.danger,
  success: colors.success,
};

export function Stat({ label, value, hint, tone = "default" }: Props) {
  return (
    <View style={styles.stat}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color: toneColors[tone] }]} numberOfLines={1}>
        {value}
      </Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stat: { flex: 1, gap: 3 },
  label: { color: colors.textMuted, fontSize: 11.5, letterSpacing: 0.6, textTransform: "uppercase" },
  value: { fontSize: 21, fontWeight: "800", letterSpacing: 0.2 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  row: { flexDirection: "row", gap: spacing.lg },
});
