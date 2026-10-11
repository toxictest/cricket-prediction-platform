import React, { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SegmentedButtons } from "react-native-paper";
import { router } from "expo-router";
import { Screen } from "../../../src/components/Screen";
import { Panel } from "../../../src/components/Panel";
import { StatusPill } from "../../../src/components/StatusPill";
import { Empty } from "../../../src/components/Empty";
import { Loading } from "../../../src/components/Loading";
import { Notice } from "../../../src/components/Notice";
import { ListFooter } from "../../../src/components/ListFooter";
import { usePoll } from "../../../src/hooks/usePoll";
import { listMatches } from "../../../src/services/matches";
import { errorMessage } from "../../../src/lib/api";
import { useAuth } from "../../../src/state/auth";
import { colors, spacing } from "../../../src/theme/theme";
import { formatDateTime, scoreLine } from "../../../src/utils/format";
import type { MatchStatus, MatchView } from "../../../src/types/api";

/*
 * Home: the fixture list.
 *
 * The endpoint is public, so this screen would work for a signed-out visitor too.
 * Keeping it behind the auth guard anyway is the right call for a member app: the
 * list is the start of a flow (pick a match, read the score, check your wallet),
 * not a landing page, and a visitor who sees fixtures but cannot act on them has
 * been shown a shop window with the door locked.
 */

type Filter = "ALL" | MatchStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "ALL", label: "ALL" },
  { value: "LIVE", label: "LIVE" },
  { value: "UPCOMING", label: "UPCOMING" },
  { value: "COMPLETED", label: "DONE" },
];

export default function MatchesScreen() {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [items, setItems] = useState<MatchView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const { user } = useAuth();

  // The first page doubles as the refresh. `usePoll` owns loading/error/refetch
  // state; this screen only owns what a list needs on top of that — the tail.
  const load = useCallback(async () => {
    const page = await listMatches({ status: filter === "ALL" ? undefined : filter, limit: 25 });
    setItems(page.items);
    setCursor(page.nextCursor);
    setMoreError(null);
    return page;
  }, [filter]);

  const state = usePoll(load);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listMatches({ status: filter === "ALL" ? undefined : filter, limit: 25, cursor });
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setCursor(page.nextCursor);
      setMoreError(null);
    } catch (error) {
      setMoreError(errorMessage(error, "Could not load more fixtures."));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, filter, loadingMore]);

  return (
    <Screen scroll={false} style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.greeting}>
          <Text style={styles.kicker}>CRICKET PREDICTION</Text>
          <Text style={styles.title}>{user?.name ? `Hi, ${user.name.split(" ")[0]}` : "Matches"}</Text>
        </View>
        {state.lastUpdated ? (
          <Text style={styles.updated}>{state.refreshing ? "refreshing…" : "synced"}</Text>
        ) : null}
      </View>

      <SegmentedButtons
        value={filter}
        onValueChange={(value) => setFilter(value as Filter)}
        density="small"
        style={styles.segment}
        buttons={FILTERS.map((option) => ({
          value: option.value,
          label: option.label,
          style: styles.segmentButton,
          labelStyle: styles.segmentLabel,
        }))}
      />

      <View style={styles.listWrap}>
        {state.loading && !state.settled ? (
          <Loading label="Loading fixtures…" />
        ) : state.error && items.length === 0 ? (
          <Notice kind="error" title="Could not load fixtures">
            {state.error}
          </Notice>
        ) : items.length === 0 ? (
          <Empty
            title={filter === "LIVE" ? "No match is live right now" : "No fixtures yet"}
            body={
              filter === "LIVE"
                ? "The board updates the moment a match goes live."
                : "Fixtures appear here as soon as they are scheduled."
            }
            actionLabel="Try again"
            onAction={() => void state.refresh()}
          />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={state.refreshing}
                onRefresh={() => void state.refresh()}
                tintColor={colors.cyan}
                colors={[colors.cyan]}
              />
            }
            ListHeaderComponent={
              state.error ? (
                <Notice kind="warn" title="Showing the last list that loaded">
                  {state.error}
                </Notice>
              ) : null
            }
            ListFooterComponent={
              <>
                {moreError ? <Notice kind="error">{moreError}</Notice> : null}
                <ListFooter
                  hasMore={Boolean(cursor)}
                  loading={loadingMore}
                  loaded={items.length}
                  noun="fixtures"
                  onLoadMore={() => void loadMore()}
                />
              </>
            }
            renderItem={({ item }) => (
              <MatchRow match={item} onPress={() => router.push({ pathname: "/match/[id]", params: { id: item.id } })} />
            )}
          />
        )}
      </View>
    </Screen>
  );
}

function MatchRow({ match, onPress }: { match: MatchView; onPress: () => void }) {
  const live = match.status === "LIVE";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${match.title}, ${match.status}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Panel accent={live ? colors.danger : colors.cyan} style={styles.panel}>
        <View style={styles.rowHead}>
          <Text style={styles.teams}>
            {match.teamA} <Text style={styles.vs}>vs</Text> {match.teamB}
          </Text>
          <StatusPill status={match.status} label={live ? "LIVE" : undefined} />
        </View>
        <Text style={styles.titleText}>{match.title}</Text>
        {match.score ? (
          <Text style={[styles.score, live && styles.scoreLive]}>
            {scoreLine(match.score.teamAScore, match.score.teamBScore, match.score.currentOver)}
          </Text>
        ) : (
          <Text style={styles.start}>{formatDateTime(match.startTime)}</Text>
        )}
      </Panel>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: spacing.md },
  greeting: { gap: 3 },
  kicker: { color: colors.cyan, fontSize: 10.5, fontWeight: "800", letterSpacing: 2.2 },
  title: { color: colors.text, fontSize: 24, fontWeight: "900" },
  updated: { color: colors.textMuted, fontSize: 11 },
  segment: { marginBottom: spacing.xs },
  segmentButton: { minHeight: 34 },
  segmentLabel: { fontSize: 11, letterSpacing: 0.6 },
  listWrap: { flex: 1 },
  listContent: { paddingTop: spacing.xs, paddingBottom: spacing.lg, gap: 0 },
  row: { marginBottom: spacing.md },
  pressed: { opacity: 0.85 },
  panel: { padding: spacing.lg },
  rowHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  teams: { color: colors.text, fontSize: 16.5, fontWeight: "800", flexShrink: 1 },
  vs: { color: colors.textMuted, fontWeight: "500", fontSize: 13 },
  titleText: { color: colors.textMuted, fontSize: 12.5 },
  score: { color: colors.text, fontSize: 14, fontVariant: ["tabular-nums"] },
  scoreLive: { color: colors.winning },
  start: { color: colors.textMuted, fontSize: 12.5 },
});
