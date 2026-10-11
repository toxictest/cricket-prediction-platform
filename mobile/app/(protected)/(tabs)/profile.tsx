import React, { useCallback, useState } from "react";
import { Alert, Image, Share, StyleSheet, Text, View } from "react-native";
import { Button, Dialog, Portal } from "react-native-paper";
import { Screen } from "../../../src/components/Screen";
import { Panel } from "../../../src/components/Panel";
import { InfoRow } from "../../../src/components/InfoRow";
import { Notice } from "../../../src/components/Notice";
import { useAuth } from "../../../src/state/auth";
import { useWallet } from "../../../src/state/wallet";
import { serverUrl } from "../../../src/lib/server";
import { colors, spacing } from "../../../src/theme/theme";
import { formatIndian, formatDateTime } from "../../../src/utils/format";
import { errorMessage } from "../../../src/lib/api";

/*
 * Profile: who you are on this platform, and the three things a member actually
 * comes here to do — check the referral link, check the balances, sign out.
 *
 * The referral *link* is built here, not fetched. The backend has no endpoint that
 * returns one (it only validates a code), and the pattern it uses on the web is
 * `?ref=<code>` on the register page, so the app follows that instead of inventing
 * a second convention the server would not recognise.
 */
export default function ProfileScreen() {
  const { user, overview, signOut, refresh } = useAuth();
  const { wallet, refresh: refreshWallet } = useWallet();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const referralCode = user?.referralCode ?? null;
  // The server this device is actually talking to, not the one compiled into the
  // binary: an invite link pointing at a host the app itself is not using is a bug
  // that only shows up on someone else's phone.
  const backend = serverUrl();
  const referralLink = referralCode ? `${backend}/register?ref=${referralCode}` : null;

  const share = useCallback(async () => {
    if (!referralLink || !referralCode) return;
    try {
      await Share.share({
        message: `Predict the cricket with me — sign up with my code ${referralCode}: ${referralLink}`,
        // Android wants `url` for the apps that handle links; iOS ignores it here.
        url: referralLink,
      });
    } catch (error) {
      setNote(errorMessage(error, "Sharing was cancelled."));
    }
  }, [referralCode, referralLink]);

  const resync = useCallback(async () => {
    setBusy(true);
    try {
      await refresh();
      await refreshWallet();
      setNote("Balances re-read from the server.");
    } finally {
      setBusy(false);
    }
  }, [refresh, refreshWallet]);

  return (
    <Screen>
      <Panel accent={colors.cyan} style={styles.identity}>
        {user?.image ? (
          <Image source={{ uri: user.image }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.initials}>{(user?.name ?? user?.email ?? "?").slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.identityText}>
          <Text style={styles.name}>{user?.name ?? "Member"}</Text>
          <Text style={styles.email}>{user?.email}</Text>
        </View>
      </Panel>

      {note ? <Notice kind="info">{note}</Notice> : null}

      {overview?.warnings?.length ? (
        <Notice kind="warn" title="Worth knowing">
          {overview.warnings.join(" ")}
        </Notice>
      ) : null}

      <Panel title="Balances" accent={colors.magenta}>
        <InfoRow label="Deposit" value={`${formatIndian(wallet?.depositBalance ?? 0)} tokens`} mono />
        <InfoRow label="Winning" value={`${formatIndian(wallet?.winningBalance ?? 0)} tokens`} mono />
        <InfoRow label="Total" value={`${formatIndian(wallet?.total ?? 0)} tokens`} mono />
        <InfoRow
          label="Withdrawable"
          value={`${formatIndian(wallet?.withdrawableBalance ?? 0)} tokens`}
          mono
        />
      </Panel>

      <Panel title="Referrals" accent={colors.cyan}>
        <InfoRow label="Your code" value={referralCode ?? "—"} mono />
        <InfoRow label="Members referred" value={String(overview?.stats.referralCount ?? 0)} mono />
        {referralLink ? (
          <>
            <Text style={styles.link} numberOfLines={2}>
              {referralLink}
            </Text>
            <Button mode="contained" textColor="#04121A" buttonColor={colors.cyan} onPress={() => void share()}>
              Share my link
            </Button>
          </>
        ) : null}
      </Panel>

      <Panel title="Account">
        <InfoRow label="Member since" value={user?.createdAt ? formatDateTime(user.createdAt) : "—"} />
        <InfoRow label="Last seen" value={user?.lastLoginAt ? formatDateTime(user.lastLoginAt) : "—"} />
        <InfoRow label="Account id" value={user?.id ?? "—"} mono />
        <View style={styles.rowActions}>
          <Button mode="outlined" textColor={colors.textMuted} loading={busy} onPress={() => void resync()}>
            Re-sync
          </Button>
          <Button mode="text" textColor={colors.danger} onPress={() => setConfirming(true)}>
            Sign out
          </Button>
        </View>
      </Panel>

      <Text style={styles.server}>Backend: {backend}</Text>

      <Portal>
        <Dialog visible={confirming} onDismiss={() => setConfirming(false)} style={styles.dialog}>
          <Dialog.Title>Sign out of this device?</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogText}>
              Your balances and claims stay on the account. You will need to sign in with Google again to
              see them here.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button textColor={colors.textMuted} onPress={() => setConfirming(false)}>
              Stay signed in
            </Button>
            <Button
              textColor={colors.danger}
              onPress={() => {
                setConfirming(false);
                // The tab navigator keeps its state until the guard swaps the
                // stack, so clearing state here is what makes "signed out" true
                // immediately rather than after the next navigation.
                Alert.alert("Signed out", "See you at the next match.");
                signOut();
              }}
            >
              Sign out
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.surfaceAlt },
  avatarFallback: { alignItems: "center", justifyContent: "center", borderColor: colors.borderBright, borderWidth: 1 },
  initials: { color: colors.cyan, fontSize: 20, fontWeight: "900" },
  identityText: { flex: 1, gap: 2 },
  name: { color: colors.text, fontSize: 18, fontWeight: "800" },
  email: { color: colors.textMuted, fontSize: 13 },
  link: { color: colors.textMuted, fontSize: 12.5, lineHeight: 18 },
  rowActions: { flexDirection: "row", gap: spacing.sm, justifyContent: "space-between", marginTop: spacing.xs },
  server: { color: colors.borderBright, fontSize: 11.5, textAlign: "center" },
  dialog: { backgroundColor: colors.surface },
  dialogText: { color: colors.text, fontSize: 14, lineHeight: 21 },
});
