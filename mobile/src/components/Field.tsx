import React from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, spacing } from "../theme/theme";

type Props = TextInputProps & {
  label: string;
  helper?: string;
  error?: string | null;
  /** Rendered inside the box, right-aligned: "tokens", "₹", a counter. */
  suffix?: string;
};

/**
 * Not `Paper.TextInput` on purpose. Paper's input works well but its label
 * animation fights `keyboardType="number-pad"` on Android, which is exactly the
 * combination every money field here needs — so the box is hand-rolled and the
 * label is a label.
 */
export function Field({ label, helper, error, suffix, style, multiline, ...input }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.box, error ? styles.boxError : null]}>
        <TextInput
          placeholderTextColor={colors.textMuted}
          style={[styles.input, multiline ? styles.multiline : null, style]}
          multiline={multiline}
          textAlignVertical={multiline ? "top" : "center"}
          {...input}
        />
        {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { color: colors.textMuted, fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase" },
  box: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
  },
  boxError: { borderColor: colors.danger },
  input: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 12, minHeight: 46 },
  multiline: { minHeight: 76, paddingTop: 12, paddingBottom: 12 },
  suffix: { color: colors.textMuted, fontSize: 13, marginLeft: spacing.sm },
  helper: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  error: { color: colors.danger, fontSize: 12.5, lineHeight: 17 },
});
