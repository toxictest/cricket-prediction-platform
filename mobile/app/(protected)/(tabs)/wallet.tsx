import React from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
import { Button } from "react-native-paper";
import { router } from "expo-router";
import { Screen } from "../../../src/components/Screen";
import { Panel } from "../../../src/components/Panel";
import { Stat } from "../../../src/components/Stat";
import { Notice } from "../../../src/components/Notice";
import { Loading } from "../../../src/components/Loading";
import { useWallet } from "../../../src/state/wallet";
import { MIN_RETAINED_TOKENS, MINIMUM_BALANCE_MESSAGE } from "../../../src/services/withdrawals";
import { colors, spacing } from "../../../src/theme/theme";
import { formatIndian, formatTokens } from "../../../src/utils/format";

/*
 * The wallet. Four numbers, one rule, three actions.
 *
 * The rule is what this screen exists to make obvious: of the tokens in
 * `winningBalance`, all but 100 can leave the account — and they are the only
 * tokens that can, since a deposit balance is never debited. That is why "Deposit"
 * reads as a receipt rather than as money you can push back.
 *
 * The wording is the server's own sentence on purpose. A member refused on the
 * withdraw screen, in the web app, or by support should be reading one rule, not
 * three paraphrases of it.
 */
export default function WalletScreen() {
  const { wallet, loading, settled, error, refreshing, refresh } = useWallet();

  if (loading && !settled) return <Loading label="Loading your wallet…" />;

  const deposit = wallet?.depositBalance ?? 0;
  const winning = wallet?.winningBalance ?? 0;
  const total = wallet?.total ?? deposit + winning;
  const withdrawable = wallet?.withdrawableBalance ?? 0;

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          tintColor={colors.cyan}
          colors={[colors.cyan]}
        />
      }
    >
      <View style={styles.header}>
        <Text style={styles.kicker}>BALANCE</Text>
        <Text style={styles.total}>{formatIndian(total)}</Text>
        <Text style={styles.totalUnit}>tokens in total</Text>
      </View>

      {error ? (
        <Notice kind="error" title="Wallet">
          {error}
        </Notice>
      ) : null}

      <Panel accent={colors.cyan}>
        <View style={styles.stats}>
          <Stat label="Deposit" value={formatIndian(deposit)} hint="from approved UPI claims" tone="deposit" />
          <View style={styles.divider} />
          <Stat label="Winning" value={formatIndian(winning)} hint="predictions and bonuses" tone="winning" />
        </View>
        <View style={styles.dividerH} />
        <Stat
          label="Withdrawable now"
          value={formatIndian(withdrawable)}
          hint={`${formatTokens(MIN_RETAINED_TOKENS)} stay in the wallet, always`}
          tone={withdrawable > 0 ? "success" : "muted"}
        />
      </Panel>

      <Notice kind="warn" title="The 100-token rule">
        {`${MINIMUM_BALANCE_MESSAGE}. A withdrawal that would take your winning balance below that is refused before anything moves.`}
      </Notice>

      <Panel title="Move tokens" accent={colors.magenta}>
        <View style={styles.actions}>
          <Button
            mode="contained"
            buttonColor={colors.cyan}
            textColor="#04121A"
            labelStyle={styles.actionLabel}
            onPress={() => router.push("/wallet/add-money")}
          >
            Add money
          </Button>
          <Button
            mode="outlined"
            textColor={colors.magenta}
            labelStyle={styles.actionLabel}
            disabled={withdrawable <= 0}
            onPress={() => router.push("/wallet/withdraw")}
          >
            Withdraw
          </Button>
          <Button mode="text" textColor={colors.textMuted} onPress={() => router.push("/wallet/transactions")}>
            Transaction history
          </Button>
        </View>
        {withdrawable <= 0 ? (
          <Text style={styles.hint}>
            Withdraw unlocks as soon as you hold more than {formatTokens(MIN_RETAINED_TOKENS)} in
            winnings.
          </Text>
        ) : null}
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.sm, gap: 2 },
  kicker: { color: colors.cyan, fontSize: 10.5, fontWeight: "800", letterSpacing: 2.2 },
  total: { color: colors.text, fontSize: 34, fontWeight: "900", fontVariant: ["tabular-nums"] },
  totalUnit: { color: colors.textMuted, fontSize: 12.5 },
  stats: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  divider: { width: 1, height: 34, backgroundColor: colors.border },
  dividerH: { height: 1, backgroundColor: colors.border },
  actions: { gap: spacing.sm },
  actionLabel: { fontSize: 14.5, paddingVertical: 6, letterSpacing: 0.4 },
  hint: { color: colors.textMuted, fontSize: 12.5, lineHeight: 18 },
});
