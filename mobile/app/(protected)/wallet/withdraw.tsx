import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, Dialog, Portal } from "react-native-paper";
import { Screen } from "../../../src/components/Screen";
import { Panel } from "../../../src/components/Panel";
import { Field } from "../../../src/components/Field";
import { Notice } from "../../../src/components/Notice";
import { StatusPill } from "../../../src/components/StatusPill";
import { Loading } from "../../../src/components/Loading";
import { ListFooter } from "../../../src/components/ListFooter";
import { Empty } from "../../../src/components/Empty";
import { usePoll } from "../../../src/hooks/usePoll";
import {
  createWithdrawalRequest,
  listMyWithdrawals,
  MINIMUM_BALANCE_MESSAGE,
  MIN_RETAINED_TOKENS,
} from "../../../src/services/withdrawals";
import { errorMessage, toUiError } from "../../../src/lib/api";
import { useWallet } from "../../../src/state/wallet";
import { validateUpiId, validateWithdrawalAmount } from "../../../src/utils/validation";
import { colors, spacing } from "../../../src/theme/theme";
import { formatIndian, formatTokens, timeAgo } from "../../../src/utils/format";
import { WITHDRAWAL_STATUS_LABELS } from "../../../src/utils/labels";
import type { MyWithdrawalItem, WithdrawalReceipt } from "../../../src/types/api";

/*
 * Withdraw.
 *
 * The one thing this screen has to make unmistakable is timing: filing a payout
 * request debits the winning balance *immediately*. The tokens leave when the
 * request is created, not when an admin approves it — that is what stops two open
 * requests spending the same tokens twice. So a rejection is not "nothing
 * happened", it is a refund, and a member who expects the balance to move only on
 * approval will read a pending request as money that has gone missing.
 *
 * The 100-token floor is previewed here and enforced by the server, in the writer
 * that updates the balance column. If the two ever disagree, the server wins and its
 * message is what appears in the error strip.
 */
export default function WithdrawScreen() {
  const { wallet, withdrawable, refresh } = useWallet();
  const history = usePoll(useCallback(() => listMyWithdrawals({ limit: 10 }), []));

  const [amount, setAmount] = useState("");
  const [upi, setUpi] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [floorHit, setFloorHit] = useState(false);
  const [receipt, setReceipt] = useState<WithdrawalReceipt | null>(null);
  const [older, setOlder] = useState<MyWithdrawalItem[]>([]);

  const winning = wallet?.winningBalance ?? 0;
  const parsed = useMemo(
    () => validateWithdrawalAmount(amount, winning, formatTokens),
    [amount, winning],
  );

  /**
   * `validateUpiId` mirrors `normalizeUpiId` in the backend — one `@`, 2–256 before it,
   * 2–64 after, 320 in total. Checked before a request files and debits, because a
   * payout to an address that cannot be paid is a refund an admin has to notice. The
   * server still decides; if the two ever disagree, its message is the one shown.
   */
  const upiError = useMemo(() => validateUpiId(upi), [upi]);

  const ready = parsed.value !== null && !parsed.error && !upiError;

  const submit = useCallback(async () => {
    if (!ready || parsed.value === null) return;
    setSubmitting(true);
    setFormError(null);
    setFloorHit(false);
    try {
      const created = await createWithdrawalRequest({ amount: parsed.value, upiId: upi.trim().toLowerCase() });
      setReceipt(created);
      setAmount("");
      setUpi("");
      setConfirming(false);
      setOlder([]);
      // The server hands back the balances after the debit in the same response, so
      // the wallet state is taken from it rather than re-guessed locally.
      refresh({ silent: true });
      void history.refresh();
    } catch (error) {
      const ui = toUiError(error, "Your request was not filed.");
      setFormError(ui.message);
      setFloorHit(ui.code === "MINIMUM_BALANCE");
    } finally {
      setSubmitting(false);
    }
  }, [ready, parsed.value, upi, refresh, history]);

  const items = [...(history.data?.items ?? []), ...older];
  const pageCursor = history.data?.nextCursor ?? null;

  return (
    <Screen keyboard>
      <Panel title="What you can take out" accent={colors.magenta}>
        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>WINNING BALANCE</Text>
            <Text style={[styles.statValue, { color: colors.winning }]}>{formatIndian(winning)}</Text>
          </View>
          <View style={styles.rule} />
          <View style={styles.stat}>
            <Text style={styles.statLabel}>WITHDRAWABLE</Text>
            <Text style={[styles.statValue, { color: withdrawable > 0 ? colors.success : colors.textMuted }]}>
              {formatIndian(withdrawable)}
            </Text>
          </View>
        </View>
        <Text style={styles.hint}>
          {`${MINIMUM_BALANCE_MESSAGE}. Deposits are never debited — they stay on your account as the record of what you added.`}
        </Text>
      </Panel>

      {receipt ? (
        <Notice kind="success" title="Request filed">
          {`${formatTokens(receipt.amount)} left your winning balance when this request was filed. Request ${receipt.id.slice(-6).toUpperCase()} is now with the payout queue — if it is rejected, the tokens come back to your winning balance as a refund.`}
        </Notice>
      ) : null}

      <Panel title="Payout request" accent={colors.cyan}>
        <Field
          label="Amount"
          placeholder={withdrawable > 0 ? String(withdrawable) : "0"}
          keyboardType="number-pad"
          suffix="tokens"
          value={amount}
          onChangeText={(value) => {
            setAmount(value);
            setFormError(null);
          }}
          error={amount.length > 0 ? parsed.error : null}
          helper={
            withdrawable > 0
              ? `Up to ${formatIndian(withdrawable)} now. ${formatTokens(MIN_RETAINED_TOKENS)} stay behind.`
              : "Nothing is withdrawable until your winnings clear the retained floor."
          }
        />
        {withdrawable > 0 ? (
          <Button
            mode="text"
            compact
            textColor={colors.cyan}
            onPress={() => setAmount(String(withdrawable))}
            style={styles.maxButton}
          >
            Take the maximum ({formatIndian(withdrawable)})
          </Button>
        ) : null}

        <Field
          label="UPI id"
          placeholder="name@okhdfcbank"
          autoCapitalize="none"
          autoCorrect={false}
          value={upi}
          onChangeText={(value) => {
            setUpi(value);
            setFormError(null);
          }}
          error={upi.length > 0 ? upiError : null}
          helper="Where the money goes if an admin approves this."
        />

        {formError ? (
          <Notice kind={floorHit ? "warn" : "error"} title={floorHit ? "The retained floor" : undefined}>
            {formError}
          </Notice>
        ) : null}

        <Notice kind="info" title="How this works">
          Filing this takes the tokens out of your wallet immediately and puts the request in a queue. An
          admin pays you outside the app, then marks it paid here. Nothing in this app moves cash.
        </Notice>

        <Button
          mode="contained"
          buttonColor={colors.magenta}
          textColor="#12041A"
          loading={submitting}
          disabled={submitting || !ready}
          onPress={() => setConfirming(true)}
          labelStyle={styles.ctaLabel}
        >
          Request payout
        </Button>
      </Panel>

      <Panel title="Your payout requests" accent={colors.border}>
        {history.loading && !history.data ? (
          <Loading />
        ) : items.length === 0 ? (
          <Empty title="No payouts requested yet" body="Every request you file shows here with its status." />
        ) : (
          <>
            {items.map((item) => (
              <View key={item.id} style={styles.row}>
                <View style={styles.rowHead}>
                  <Text style={styles.rowAmount}>{formatIndian(item.amount)}</Text>
                  <StatusPill status={item.status} label={WITHDRAWAL_STATUS_LABELS[item.status]} />
                </View>
                <Text style={styles.rowMeta}>
                  {item.upiId} · {timeAgo(item.createdAt)}
                  {item.adminUtr ? ` · ref ${item.adminUtr}` : ""}
                </Text>
                {item.reviewNote ? <Text style={styles.rowNote}>“{item.reviewNote}”</Text> : null}
              </View>
            ))}
            <ListFooter
              hasMore={Boolean(pageCursor)}
              loading={false}
              loaded={items.length}
              noun="requests"
              onLoadMore={async () => {
                if (!pageCursor) return;
                const page = await listMyWithdrawals({ limit: 10, cursor: pageCursor });
                setOlder((current) => [...current, ...page.items]);
              }}
            />
          </>
        )}
      </Panel>

      <Portal>
        <Dialog visible={confirming} onDismiss={() => (submitting ? undefined : setConfirming(false))} style={styles.dialog}>
          <Dialog.Title>Move {formatIndian(parsed.value ?? 0)} tokens out?</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogText}>
              {parsed.value === null
                ? "Fix the amount first."
                : `${formatTokens(parsed.value)} leave your winning balance as soon as this is filed, and ${formatIndian(winning - parsed.value)} stay behind. The payout goes to ${upi.trim().toLowerCase()}.`}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button textColor={colors.textMuted} onPress={() => setConfirming(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              textColor={colors.magenta}
              loading={submitting}
              disabled={parsed.value === null}
              onPress={() => void submit()}
            >
              File the request
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  stat: { flex: 1, gap: 2 },
  statLabel: { color: colors.textMuted, fontSize: 11, letterSpacing: 0.8, fontWeight: "700" },
  statValue: { fontSize: 22, fontWeight: "900", fontVariant: ["tabular-nums"] },
  rule: { width: 1, height: 32, backgroundColor: colors.border },
  hint: { color: colors.textMuted, fontSize: 12.5, lineHeight: 18 },
  maxButton: { alignSelf: "flex-start" },
  ctaLabel: { fontSize: 15, paddingVertical: 6 },
  row: { gap: 3, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  rowHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  rowAmount: { color: colors.text, fontSize: 15, fontWeight: "800", fontVariant: ["tabular-nums"] },
  rowMeta: { color: colors.textMuted, fontSize: 12 },
  rowNote: { color: colors.warning, fontSize: 12.5, lineHeight: 18 },
  dialog: { backgroundColor: colors.surface },
  dialogText: { color: colors.text, fontSize: 14, lineHeight: 21 },
});
