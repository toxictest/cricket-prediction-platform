import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "../theme/theme";

/*
 * The bottom bar, built here instead of themed.
 *
 * Three destinations with labels need no icon set, and an accent rule under the
 * active label is the only signal a bar this short has room for.
 *
 * `BottomTabBarProps` is not importable — SDK 57 vendors React Navigation inside
 * `expo-router` rather than exposing it — so the shape is described structurally
 * for exactly the fields this component reads. That is safe rather than loose: the
 * object is passed by the navigator at the call site, so if React Navigation ever
 * changes `descriptors` or `navigate`, the JSX stops typechecking and the breakage
 * is found here, not on a device.
 */
type TabBarProps = {
  navigation: { navigate: (name: string) => void };
  state: { index: number; routes: { key: string; name: string }[] };
  descriptors: Record<string, { options?: { tabBarLabel?: unknown } }>;
};

export function CyberTabBar({ navigation, state, descriptors }: TabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const configured = descriptors[route.key]?.options?.tabBarLabel;
        // `tabBarLabel` is allowed to be a render function upstream; this bar only ever
        // sets a string, so anything else falls back to the route name instead of
        // rendering a function object.
        const label = typeof configured === "string" ? configured : route.name;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            onPress={() => navigation.navigate(route.name)}
            style={styles.item}
          >
            <Text style={[styles.label, focused ? styles.labelActive : null]}>{label}</Text>
            <View style={[styles.rule, focused ? null : styles.ruleIdle]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  item: { flex: 1, alignItems: "center", gap: 6, paddingVertical: 4 },
  label: { color: colors.textMuted, fontSize: 12.5, fontWeight: "700", letterSpacing: 0.8 },
  labelActive: { color: colors.cyan },
  rule: { height: 2, width: 26, borderRadius: 1, backgroundColor: colors.cyan },
  ruleIdle: { backgroundColor: "transparent" },
});
