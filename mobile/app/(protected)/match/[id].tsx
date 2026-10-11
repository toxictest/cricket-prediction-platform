import React, { useCallback, useEffect, useRef, useState } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { Screen } from "../../../src/components/Screen";
import { Panel } from "../../../src/components/Panel";
import { Stat } from "../../../src/components/Stat";
import { StatusPill } from "../../../src/components/StatusPill";
import { Notice } from "../../../src/components/Notice";
import { Loading } from "../../../src/components/Loading";
import { usePoll } from "../../../src/hooks/usePoll";
import { getLiveScore } from "../../../src/services/matches";
import { SCORE_POLL_MS } from "../../../src/lib/config";
import { colors, spacing } from "../../../src/theme/theme";
import { formatDateTime, timeAgo } from "../../../src/utils/format";
import type { LiveScorePayload } from "../../../src/types/api";

/*
 * Live score for one match.
 *
 * Two details here are load-bearing:
 *
 * 1. Every poll sends the `etag` from the last response. The server answers 304
 *    with no body when the scoreboard has not moved, so polling every 12 seconds
 *    while a match is live costs a header instead of a payload. When the match is
 *    finished the interval drops to zero — a completed score does not change, and
 *    an app that polls it anyway is a load test nobody asked for.
 * 2. A 304 or a failed poll must keep the numbers on screen. The last known score
 *    with a "updated 40s ago" line is honest; an empty board is not.
 */
export default function MatchScoreScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = String(params.id ?? "");
  const etag = useRef<string | null>(null);

  const load = useCallback(async () => {
    const result = await getLiveScore(id, etag.current);
    if (result.etag) etag.current = result.etag;
    return result.data;
  }, [id]);

  /**
   * Whether to keep polling can only be known from the first response, and a hook
   * cannot read its own output while it is being called — so the interval is
   * separate state that the response updates. `usePoll` re-subscribes when it
   * changes: a LIVE match polls every 12 seconds, anything finished polls never.
   */
  const [intervalMs, setIntervalMs] = useState(0);
  const state = usePoll<LiveScorePayload>(load, { enabled: id.length > 0, intervalMs });

  const payload = state.data;
  const live = payload?.match.status === "LIVE";

  useEffect(() => {
    setIntervalMs(payload?.match.status === "LIVE" ? SCORE_POLL_MS : 0);
  }, [payload?.match.status]);

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={state.refreshing}
          onRefresh={() => void state.refresh()}
          tintColor={colors.cyan}
          colors={[colors.cyan]}
        />
      }
    >
      <Stack.Screen options={{ title: payload?.match.title ?? "Match" }} />

      {state.loading && !payload ? (
        <Loading label="Reading the board…" />
      ) : !payload ? (
        <Notice kind={state.error ? "error" : "info"} title={state.error ? "Could not load this match" : undefined}>
          {state.error ?? "This match has no board yet."}
        </Notice>
      ) : (
        <>
          <Panel accent={live ? colors.danger : colors.cyan}>
            <View style={styles.head}>
              <Text style={styles.title}>{payload.match.title}</Text>
              <StatusPill status={payload.match.status} label={live ? "LIVE" : undefined} />
            </View>

            {payload.score ? (
              <>
                <ScoreRow label={payload.match.teamA} value={payload.score.teamAScore} primary />
                <View style={styles.rule} />
                <ScoreRow label={payload.match.teamB} value={payload.score.teamBScore} />
                <View style={styles.overRow}>
                  <Text style={styles.over}>Over {payload.score.currentOver || "—"}</Text>
                  <Text style={styles.updated}>
                    updated {timeAgo(payload.score.updatedAt)} · v{payload.score.version}
                  </Text>
                </View>
              </>
            ) : (
              <Text style={styles.pending}>
                No scoreboard entry yet. This match is {payload.match.status.toLowerCase()} and the board
                fills in once a scorer posts the first over.
              </Text>
            )}
          </Panel>

          {payload.score?.batsmanStats ? (
            <Panel title="At the crease">
              <StatsTable value={payload.score.batsmanStats} />
            </Panel>
          ) : null}
          {payload.score?.bowlerStats ? (
            <Panel title="Bowling">
              <StatsTable value={payload.score.bowlerStats} />
            </Panel>
          ) : null}

          <Panel title="Fixture">
            <View style={styles.stats}>
              <Stat label="Starts" value={formatDateTime(payload.match.startTime)} />
              <View style={styles.divider} />
              <Stat label="Refresh" value={live ? `every ${Math.round(SCORE_POLL_MS / 1000)}s` : "on pull"} />
            </View>
            {live ? (
              <Text style={styles.hint}>
                This screen updates itself while the match is live. Pull down to force a read.
              </Text>
            ) : null}
          </Panel>

          {state.error && payload ? (
            <Notice kind="warn" title="Showing the last score that arrived">
              {state.error}
            </Notice>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function ScoreRow({ label, value, primary }: { label: string; value: string; primary?: boolean }) {
  return (
    <View style={styles.scoreRow}>
      <Text style={[styles.team, primary && styles.teamPrimary]}>{label}</Text>
      <Text style={[styles.score, primary && styles.scorePrimary]}>{value || "—"}</Text>
    </View>
  );
}

/*
 * The stats JSON is whatever the scorer posted: the backend validates that it is one
 * object or a short list of them, with scalar values, and deliberately does not
 * invent a schema for a cricket scorecard. So the app renders it the same way —
 * label plus key/value pairs — rather than assuming `batsmanStats[0].runs` exists.
 *
 * A first-name key is picked from a short list, which is how a scorer tends to
 * write it, and anything unrecognised still shows up as its own row instead of
 * silently disappearing.
 */
const NAME_KEYS = ["name", "batter", "bat", "player", "bowler", "label"];

type StatEntry = Record<string, string | number | boolean>;

function asEntries(value: unknown): StatEntry[] {
  if (Array.isArray(value)) return value.filter((row): row is StatEntry => typeof row === "object" && row !== null);
  if (typeof value === "object" && value !== null) return [value as StatEntry];
  return [];
}

function StatsTable({ value }: { value: unknown }) {
  const entries = asEntries(value);
  if (entries.length === 0) return <Text style={styles.hint}>Nothing recorded yet.</Text>;

  return (
    <View style={styles.table}>
      {entries.map((entry, index) => {
        const nameKey = NAME_KEYS.find((key) => typeof entry[key] === "string");
        const name = nameKey ? String(entry[nameKey]) : `Entry ${index + 1}`;
        const rest = Object.keys(entry)
          .filter((key) => key !== nameKey)
          .slice(0, 6);

        return (
          <View key={`${name}-${index}`} style={styles.tr}>
            <Text style={styles.tdName} numberOfLines={1}>
              {name}
            </Text>
            <View style={styles.tds}>
              {rest.map((key) => (
                <Text key={key} style={styles.td}>
                  <Text style={styles.tdKey}>{key} </Text>
                  {String(entry[key])}
                </Text>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  title: { color: colors.text, fontSize: 16, fontWeight: "800", flexShrink: 1 },
  scoreRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.md },
  team: { color: colors.textMuted, fontSize: 14, fontWeight: "700", flex: 1 },
  teamPrimary: { color: colors.text },
  score: { color: colors.textMuted, fontSize: 22, fontWeight: "900", fontVariant: ["tabular-nums"] },
  scorePrimary: { color: colors.winning },
  rule: { height: 1, backgroundColor: colors.border },
  overRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  over: { color: colors.text, fontSize: 13.5, fontWeight: "700" },
  updated: { color: colors.textMuted, fontSize: 11.5 },
  pending: { color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  hint: { color: colors.textMuted, fontSize: 12.5, lineHeight: 18 },
  stats: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  divider: { width: 1, height: 32, backgroundColor: colors.border },
  table: { gap: spacing.sm },
  tr: { gap: 3, paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
  tdName: { color: colors.text, fontSize: 14, fontWeight: "700" },
  tds: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  td: { color: colors.text, fontSize: 12.5 },
  tdKey: { color: colors.textMuted },
});
