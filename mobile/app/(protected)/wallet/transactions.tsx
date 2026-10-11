import React, { useCallback, useState } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
import { Screen } from "../../../src/components/Screen";
import { Panel } from "../../../src/components/Panel";
import { Notice } from "../../../src/components/Notice";
import { Loading } from "../../../src/components/Loading";
import { Empty } from "../../../src/components/Empty";
import { ListFooter } from "../../../src/components/ListFooter";
import { usePoll } from "../../../src/hooks/usePoll";
import { listTransactions } from "../../../src/services/wallet";
import { colors, spacing } from "../../../src/theme/theme";
import { formatDateTime, formatIndian, timeAgo } from "../../../src/utils/format";
import { BALANCE_LABELS, ledgerLabel, signedAmount } from "../../../src/utils/labels";
import type { LedgerEntry } from "../../../src/types/api";

/*
 * The ledger.
 *
 * Only movements that actually happened are here. A deposit claim that is still
 * waiting for review is *not* a row, and neither is a payout request that has been
 * rejected but not yet refunded — which is worth saying out loud on the screen,
 * because "where is my ₹500" is the question this list gets asked.
 *
 * `amount` arrives signed from the server and `balanceAfter` is the balance at the
 * moment of the write, so nothing here re-derives a running total from the visible
 * page: the first row's `balanceAfter` is the wallet's current number, and the
 * page above it is not the whole history.
 */
export default function TransactionsScreen() {
  const state = usePoll(useCallback(() => listTransactions({ limit: 25 }), []));
  const [older, setOlder] = useState<LedgerEntry[]>([]);

  const items = [...(state.data?.items ?? []), ...older];
  const cursor = state.data?.nextCursor ?? null;

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
      {state.error && items.length === 0 ? (
        <Notice kind="error" title="Could not load the ledger">
          {state.error}
        </Notice>
      ) : null}

      {state.loading && !state.settled ? (
        <Loading label="Loading your history…" />
      ) : items.length === 0 && !state.error ? (
        <Empty
          title="No movements yet"
          body="A row appears when tokens are credited or debited. A deposit claim that is still waiting for review is not a movement, so it is not here."
          actionLabel="Try again"
          onAction={() => void state.refresh()}
        />
      ) : (
        <Panel accent={colors.cyan}>
          <Text style={styles.legend}>
            Credits and debits on both balances. Pending claims do not appear here.
          </Text>
          {items.map((entry, index) => (
            <Row key={entry.id} entry={entry} last={index === items.length - 1} />
          ))}
          <ListFooter
            hasMore={Boolean(cursor)}
            loading={false}
            loaded={items.length}
            noun="entries"
            onLoadMore={async () => {
              if (!cursor) return;
              const page = await listTransactions({ limit: 25, cursor });
              setOlder((current) => [...current, ...page.items]);
            }}
          />
        </Panel>
      )}
    </Screen>
  );
}

function Row({ entry, last }: { entry: LedgerEntry; last: boolean }) {
  const credit = entry.amount >= 0;
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={styles.marker}>
        <View style={[styles.dot, { backgroundColor: credit ? colors.success : colors.danger }]} />
      </View>
      <View style={styles.body}>
        <View style={styles.head}>
          <Text style={styles.label}>{ledgerLabel(entry.type)}</Text>
          <Text style={[styles.amount, { color: credit ? colors.success : colors.danger }]}>
            {signedAmount(entry.amount)}
          </Text>
        </View>
        <Text style={styles.meta}>
          {BALANCE_LABELS[entry.balanceType] ?? entry.balanceType} · {formatIndian(entry.balanceAfter)} after
        </Text>
        {entry.description ? <Text style={styles.description}>{entry.description}</Text> : null}
        <Text style={styles.time}>{`${formatDateTime(entry.createdAt)} · ${timeAgo(entry.createdAt)}`}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  row: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLast: { borderBottomWidth: 0 },
  marker: { width: 12, paddingTop: 5, alignItems: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  body: { flex: 1, gap: 2 },
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.md },
  label: { color: colors.text, fontSize: 14.5, fontWeight: "700", flexShrink: 1 },
  amount: { fontSize: 15, fontWeight: "900", fontVariant: ["tabular-nums"] },
  meta: { color: colors.textMuted, fontSize: 12 },
  description: { color: colors.text, fontSize: 12.5, lineHeight: 18 },
  time: { color: colors.borderBright, fontSize: 11 },
});
