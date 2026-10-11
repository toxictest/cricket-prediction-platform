import React, { useCallback, useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Button, ActivityIndicator } from "react-native-paper";
import { Screen } from "../../../src/components/Screen";
import { Panel } from "../../../src/components/Panel";
import { Field } from "../../../src/components/Field";
import { Notice } from "../../../src/components/Notice";
import { StatusPill } from "../../../src/components/StatusPill";
import { Loading } from "../../../src/components/Loading";
import { ListFooter } from "../../../src/components/ListFooter";
import { Empty } from "../../../src/components/Empty";
import { usePoll } from "../../../src/hooks/usePoll";
import { createPaymentRequest, getPaymentQr, listMyPayments, PAYMENT_LIMITS } from "../../../src/services/payments";
import { uploadAvailable, uploadEndpoint, uploadScreenshot } from "../../../src/services/uploads";
import { errorMessage, toUiError } from "../../../src/lib/api";
import { useWallet } from "../../../src/state/wallet";
import { colors, spacing } from "../../../src/theme/theme";
import { formatDateTime, formatIndian, formatRupees, timeAgo } from "../../../src/utils/format";
import { PAYMENT_STATUS_LABELS } from "../../../src/utils/labels";
import type { MyPaymentRequest, PaymentReceipt } from "../../../src/types/api";

/*
 * Add money.
 *
 * The shape of this screen is the shape of the rule behind it: the platform has no
 * payment gateway. A member pays a UPI handle, then *claims* that they did, and a
 * human with a PAYMENT_ADMIN or SUPER_ADMIN role compares the claim against the bank
 * statement before a single token appears in the wallet. Nothing on this screen
 * credits anything, and the copy says so — a member who believes submitting this
 * form moved money is a member who calls support at 11pm.
 */

const MAX_UTR = PAYMENT_LIMITS.maxUtrLength;

export default function AddMoneyScreen() {
  const qr = usePoll(useCallback(() => getPaymentQr(), []));
  const history = usePoll(useCallback(() => listMyPayments({ limit: 10 }), []));
  const { refresh } = useWallet();

  const [amount, setAmount] = useState("");
  const [utr, setUtr] = useState("");
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [older, setOlder] = useState<MyPaymentRequest[]>([]);
  // Paging the history is the screen's business, not the poll's: `usePoll` owns the
  // first page and re-runs it on focus, and a tail of older rows appended to that
  // would be lost on the next refresh — so the tail and its cursor live here.
  const [tail, setTail] = useState<string | null>(null);

  const amountNumber = Number(amount);
  const errors = {
    amount:
      amount.trim() === ""
        ? "Enter the amount you paid."
        : !Number.isFinite(amountNumber) || !Number.isInteger(amountNumber)
          ? "Amounts are whole rupees, no decimals."
          : amountNumber < PAYMENT_LIMITS.minAmount || amountNumber > PAYMENT_LIMITS.maxAmount
            ? `Between ${formatRupees(PAYMENT_LIMITS.minAmount)} and ${formatRupees(PAYMENT_LIMITS.maxAmount)}.`
            : null,
    utr:
      utr.trim().length === 0
        ? "The UTR is how an admin finds your payment in the bank statement."
        : utr.trim().length < PAYMENT_LIMITS.minUtrLength || utr.trim().length > MAX_UTR
          ? `A UTR is ${PAYMENT_LIMITS.minUtrLength} to ${MAX_UTR} characters.`
          : null,
    url:
      url.trim().length === 0
        ? "Paste the link to your payment screenshot."
        : !/^https:\/\//i.test(url.trim())
          ? "The link has to start with https://"
          : null,
  };
  const valid = !errors.amount && !errors.utr && !errors.url;

  const pick = useCallback(async () => {
    setFormError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      allowsMultipleSelection: false,
    });
    if (result.canceled || result.assets.length === 0) return;

    const asset = result.assets[0];
    setPicked(asset);

    if (!uploadAvailable()) {
      setFormError(
        "Your photo is shown here for your own reference. This backend stores no uploads, so paste a link to the screenshot instead.",
      );
      return;
    }

    setUploading(true);
    try {
      const hosted = await uploadScreenshot({ uri: asset.uri, fileName: asset.fileName, mimeType: asset.mimeType });
      setUrl(hosted);
    } catch (error) {
      setFormError(errorMessage(error, "The upload failed. Paste the link instead."));
    } finally {
      setUploading(false);
    }
  }, []);

  const submit = useCallback(async () => {
    if (!valid) {
      setFormError("Fix the highlighted fields first.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const created = await createPaymentRequest({
        amount: amountNumber,
        utrNumber: utr.trim().toUpperCase(),
        screenshotUrl: url.trim(),
      });
      setReceipt(created);
      setAmount("");
      setUtr("");
      setUrl("");
      setPicked(null);
      setOlder([]);
      setTail(null);
      await Promise.all([refresh({ silent: true }), history.refresh()]);
    } catch (error) {
      // The server's own sentence, because it is the one that explains the rule:
      // a duplicate UTR, five open claims, or the money gate being closed.
      const ui = toUiError(error, "Your claim was not filed.");
      setFormError(ui.message);
    } finally {
      setSubmitting(false);
    }
  }, [amountNumber, valid, utr, url, refresh, history]);

  const items = [...(history.data?.items ?? []), ...older];
  const pageCursor = history.data?.nextCursor ?? tail;

  return (
    <Screen keyboard>
      <Panel title="Which QR do I pay?" accent={colors.cyan}>
        {qr.loading && !qr.data ? (
          <Loading />
        ) : qr.error && !qr.data ? (
          <Notice kind="warn" title="No QR published right now">
            {qr.error}
          </Notice>
        ) : qr.data ? (
          <>
            <Text style={styles.meta}>
              {qr.data.teamA} vs {qr.data.teamB} · {formatDateTime(qr.data.startTime)}
            </Text>
            <View style={styles.qrBox}>
              <Image source={{ uri: qr.data.qrCodeUrl }} style={styles.qr} resizeMode="contain" />
            </View>
            <Button mode="outlined" textColor={colors.cyan} onPress={() => void Linking.openURL(qr.data!.qrCodeUrl)}>
              Open the QR image
            </Button>
            <Text style={styles.hint}>
              Pay any amount you like, then claim it below. {formatIndian(1)} token is credited per{" "}
              {formatRupees(1)} once an admin matches your UTR against the statement.
            </Text>
          </>
        ) : null}
      </Panel>

      {receipt ? (
        <Notice kind="success" title="Claim filed">
          {`${formatRupees(receipt.amount)} claimed as ${receipt.utrNumber}. It shows as ${PAYMENT_STATUS_LABELS[receipt.status].toLowerCase()} until an admin approves it — nothing has been credited yet.`}
        </Notice>
      ) : null}

      <Panel title="File a claim" accent={colors.magenta}>
        <Field
          label="Amount paid"
          placeholder="500"
          keyboardType="number-pad"
          suffix="₹"
          value={amount}
          onChangeText={setAmount}
          error={amount.length > 0 ? errors.amount : null}
          helper={`Whole rupees, ${formatRupees(PAYMENT_LIMITS.minAmount)}–${formatRupees(PAYMENT_LIMITS.maxAmount)}.`}
        />
        <Field
          label="UTR / bank reference"
          placeholder="449876543210"
          autoCapitalize="characters"
          autoCorrect={false}
          value={utr}
          onChangeText={setUtr}
          error={utr.length > 0 ? errors.utr : null}
          helper="The 12-digit UTR from your UPI app's transaction details."
        />
        <Field
          label="Screenshot link"
          placeholder="https://…"
          autoCapitalize="none"
          autoCorrect={false}
          value={url}
          onChangeText={setUrl}
          error={url.length > 0 && !uploadAvailable() ? errors.url : null}
          helper={
            uploadAvailable()
              ? `Uploaded via ${uploadEndpoint}`
              : "This backend accepts a hosted link; it stores no files."
          }
        />

        <Pressable onPress={() => void pick()} style={({ pressed }) => [styles.picker, pressed && styles.pressed]}>
          {picked ? (
            <Image source={{ uri: picked.uri }} style={styles.preview} resizeMode="cover" />
          ) : (
            <View style={styles.pickerBody}>
              <Text style={styles.pickerTitle}>Attach the payment screenshot</Text>
              <Text style={styles.pickerHint}>
                {uploadAvailable() ? "Picked, uploaded, and the link lands above." : "For your reference — then paste the link."}
              </Text>
            </View>
          )}
          {uploading ? (
            <View style={styles.uploading}>
              <ActivityIndicator size="small" color={colors.cyan} />
            </View>
          ) : null}
        </Pressable>

        {formError ? <Notice kind="error">{formError}</Notice> : null}

        <Button
          mode="contained"
          buttonColor={colors.cyan}
          textColor="#04121A"
          loading={submitting}
          disabled={submitting}
          onPress={() => void submit()}
          labelStyle={styles.ctaLabel}
        >
          Submit claim
        </Button>
        <Text style={styles.footnote}>
          Claims can be reviewed only while they are pending, and an approved one is not reversible from
          the app or the panel.
        </Text>
      </Panel>

      <Panel title="Your claims" accent={colors.border}>
        {history.loading && !history.data ? (
          <Loading />
        ) : items.length === 0 ? (
          <Empty title="No claims yet" body="Anything you file appears here with its review status." />
        ) : (
          <>
            {items.map((item) => (
              <View key={item.id} style={styles.claim}>
                <View style={styles.claimHead}>
                  <Text style={styles.claimAmount}>{formatRupees(item.amount)}</Text>
                  <StatusPill status={item.status} label={PAYMENT_STATUS_LABELS[item.status]} />
                </View>
                <Text style={styles.claimMeta}>
                  {item.utrNumber} · {item.tokensToCredit} tokens · {timeAgo(item.createdAt)}
                </Text>
                {item.reviewNote ? <Text style={styles.claimNote}>“{item.reviewNote}”</Text> : null}
              </View>
            ))}
            <ListFooter
              hasMore={Boolean(pageCursor)}
              loading={false}
              loaded={items.length}
              noun="claims"
              onLoadMore={async () => {
                if (!pageCursor) return;
                const page = await listMyPayments({ limit: 10, cursor: pageCursor });
                setOlder((current) => [...current, ...page.items]);
                setTail(page.nextCursor);
              }}
            />
          </>
        )}
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: { color: colors.textMuted, fontSize: 12.5 },
  qrBox: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 14, padding: spacing.md },
  qr: { width: 210, height: 210, backgroundColor: "#FFFFFF" },
  hint: { color: colors.textMuted, fontSize: 12.5, lineHeight: 18 },
  picker: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderBright,
    borderRadius: 14,
    overflow: "hidden",
    minHeight: 76,
    justifyContent: "center",
  },
  pressed: { opacity: 0.85 },
  pickerBody: { padding: spacing.md, gap: 2 },
  pickerTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  pickerHint: { color: colors.textMuted, fontSize: 12 },
  preview: { width: "100%", height: 170 },
  uploading: { position: "absolute", top: spacing.sm, right: spacing.sm },
  ctaLabel: { fontSize: 15, paddingVertical: 6 },
  footnote: { color: colors.textMuted, fontSize: 11.5, lineHeight: 17 },
  claim: { gap: 3, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  claimHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  claimAmount: { color: colors.text, fontSize: 15, fontWeight: "800" },
  claimMeta: { color: colors.textMuted, fontSize: 12 },
  claimNote: { color: colors.warning, fontSize: 12.5, lineHeight: 18 },
});
