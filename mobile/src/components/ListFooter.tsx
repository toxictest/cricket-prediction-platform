import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "react-native-paper";
import { colors, spacing } from "../theme/theme";

type Props = {
  hasMore: boolean;
  loading: boolean;
  loaded: number;
  onLoadMore: () => void;
  /** What one unit is called, for the "32 of 32 shown" line. */
  noun?: string;
};

/**
 * Explicit "load more" rather than an infinite scroll: on a keyset-paged API an
 * invisible auto-trigger at the bottom of a short list fires forever, and a member
 * watching a number climb cannot tell that from the server losing their history.
 */
export function ListFooter({ hasMore, loading, loaded, onLoadMore, noun = "items" }: Props) {
  if (!hasMore) {
    return (
      <View style={styles.end}>
        <Text style={styles.endText}>{loaded > 0 ? `End of ${noun}` : `No ${noun} yet`}</Text>
      </View>
    );
  }
  return (
    <View style={styles.wrap}>
      <Button mode="outlined" compact loading={loading} onPress={onLoadMore} textColor={colors.cyan}>
        Load more
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: spacing.md, alignItems: "center" },
  end: { paddingVertical: spacing.lg, alignItems: "center" },
  endText: { color: colors.textMuted, fontSize: 12.5, letterSpacing: 0.4 },
});
