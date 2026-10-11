import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "react-native-paper";
import { colors, spacing } from "../theme/theme";

type Props = { title: string; body?: string; actionLabel?: string; onAction?: () => void };

/** An empty list is a state, not an error — but a failed load must not look like an empty list. */
export function Empty({ title, body, actionLabel, onAction }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <Button mode="outlined" textColor={colors.cyan} style={styles.action} onPress={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl, alignItems: "center", gap: spacing.sm },
  title: { color: colors.text, fontSize: 15, fontWeight: "700", textAlign: "center" },
  body: { color: colors.textMuted, fontSize: 13, lineHeight: 19, textAlign: "center" },
  action: { marginTop: spacing.sm },
});
