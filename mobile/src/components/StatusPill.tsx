import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { statusColors } from "../theme/theme";

type Props = { status: string; label?: string };

/** Same colour for the same word everywhere: a PENDING claim and a PENDING payout look alike. */
export function StatusPill({ status, label }: Props) {
  const color = statusColors[status] ?? "#8B9AB4";
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.text, { color }]}>{label ?? status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 11, fontWeight: "800", letterSpacing: 0.7 },
});
