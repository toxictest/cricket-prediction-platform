import React, { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme/theme";

type Props = {
  children?: ReactNode;
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  accent?: string;
  style?: object;
};

/** A bordered block. `accent` paints the short neon rule in the top-left corner. */
export function Panel({ children, title, subtitle, right, accent, style }: Props) {
  return (
    <View style={[styles.panel, style]}>
      {accent ? <View style={[styles.rule, { backgroundColor: accent }]} /> : null}
      {title || right ? (
        <View style={styles.head}>
          <View style={styles.headText}>
            {title ? <Text style={styles.title}>{title}</Text> : null}
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.md,
    overflow: "hidden",
  },
  rule: { position: "absolute", top: 0, left: 0, width: 46, height: 3 },
  head: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  headText: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: 15, fontWeight: "700", letterSpacing: 0.3 },
  subtitle: { color: colors.textMuted, fontSize: 12.5, lineHeight: 17 },
});
