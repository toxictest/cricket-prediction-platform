import React, { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme/theme";

type Kind = "info" | "warn" | "error" | "success";

const palette: Record<Kind, { border: string; tint: string; background: string }> = {
  info: { border: "#1E3A5F", tint: colors.cyan, background: "#08131F" },
  warn: { border: "#4A3A12", tint: colors.warning, background: "#171204" },
  error: { border: "#4A1D1D", tint: colors.danger, background: "#180808" },
  success: { border: "#123B2C", tint: colors.success, background: "#07140F" },
};

type Props = { kind?: Kind; title?: string; children: ReactNode; action?: ReactNode };

/** The one place the app explains itself: a rule, a failure, or a success. */
export function Notice({ kind = "info", title, children, action }: Props) {
  const tone = palette[kind];
  return (
    <View style={[styles.notice, { borderColor: tone.border, backgroundColor: tone.background }]}>
      <View style={[styles.bar, { backgroundColor: tone.tint }]} />
      <View style={styles.body}>
        {title ? <Text style={[styles.title, { color: tone.tint }]}>{title}</Text> : null}
        <View style={styles.content}>
          <Text style={styles.text}>{children}</Text>
          {action}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  bar: { width: 3 },
  body: { flex: 1, padding: spacing.md, gap: 3 },
  content: { gap: spacing.sm },
  title: { fontSize: 12.5, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  text: { color: colors.text, fontSize: 13.5, lineHeight: 19 },
});
