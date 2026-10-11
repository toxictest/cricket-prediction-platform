import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "react-native-paper";
import { Screen } from "../src/components/Screen";
import { Panel } from "../src/components/Panel";
import { Notice } from "../src/components/Notice";
import { Field } from "../src/components/Field";
import { useAuth } from "../src/state/auth";
import {
  addressEditable,
  applyServerUrl,
  compiledUrl,
  probeServer,
  serverUrl,
  type ProbeResult,
} from "../src/lib/server";
import { colors, spacing } from "../src/theme/theme";

/**
 * Sign-in. One real button, one developer escape hatch.
 *
 * The button hands off to the browser, where Google already works for this
 * backend; the paste field adopts a bearer token minted by `npm run mobile:token`
 * on the server. It is shown only when the app was built with
 * EXPO_PUBLIC_ALLOW_DEV_TOKEN=1, so a store build cannot be talked into accepting a
 * pasted credential by someone who read this source file.
 *
 * The server-address editor below is likewise conditional — it appears only when this
 * build was baked with a plain-http URL, i.e. a LAN test build. A deployed app has no
 * field that could point a member's credentials at somebody else's host.
 */
export default function LoginScreen() {
  const { startGoogleSignIn, useToken, busy, error } = useAuth();
  const allowDevToken = process.env.EXPO_PUBLIC_ALLOW_DEV_TOKEN === "1";
  const editable = addressEditable();
  const [token, setToken] = useState("");
  const [referral, setReferral] = useState("");

  const [address, setAddress] = useState(serverUrl());
  const [addressError, setAddressError] = useState<string | null>(null);
  const [addressSaved, setAddressSaved] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);

  const test = useCallback(async () => {
    setProbing(true);
    setProbe(null);
    setProbe(await probeServer(address));
    setProbing(false);
  }, [address]);

  const save = useCallback(async () => {
    setAddressError(null);
    setAddressSaved(null);
    const result = await applyServerUrl(address);
    if (result.ok) setAddressSaved(result.url);
    else setAddressError(result.error);
  }, [address]);

  const reset = useCallback(async () => {
    await applyServerUrl("");
    setAddress(compiledUrl());
    setAddressSaved(null);
    setAddressError(null);
    setProbe(null);
  }, []);

  return (
    <Screen>
      <View style={styles.head}>
        <Text style={styles.kicker}>CRICKET PREDICTION</Text>
        <Text style={styles.title}>Tokens, not cash.</Text>
        <Text style={styles.sub}>
          Predict the match, build your balance, and withdraw what you win. Everything here moves on
          the same account as the website.
        </Text>
      </View>

      {error ? <Notice kind="error" title="Sign-in">{error.message}</Notice> : null}

      <Panel title="Continue with Google" accent={colors.cyan}>
        <Text style={styles.body}>
          Opens your browser, signs you in the way the website does, and brings you straight back here.
          A new Google account gets its wallet and referral code automatically.
        </Text>
        <Field
          label="Referral code (optional)"
          placeholder="CRC-XXXXXX"
          autoCapitalize="characters"
          value={referral}
          onChangeText={setReferral}
          helper="Only used the first time you sign in."
        />
        <Button
          mode="contained"
          loading={busy}
          disabled={busy}
          onPress={() => void startGoogleSignIn(referral.trim() || null)}
          buttonColor={colors.cyan}
          textColor="#04121A"
          labelStyle={styles.buttonLabel}
        >
          Sign in with Google
        </Button>
      </Panel>

      {editable ? (
        <Panel title="Server address" accent={colors.warning}>
          <Text style={styles.body}>
            This build was compiled for a development server, so the address can be changed on the
            device instead of rebuilding the APK for every Wi-Fi. It is stored on this phone only.
          </Text>
          <Field
            label="Backend"
            placeholder="http://192.168.1.20:3000"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={address}
            onChangeText={(value) => {
              setAddress(value);
              setAddressError(null);
              setAddressSaved(null);
              setProbe(null);
            }}
            error={addressError}
            helper={`Baked into this build: ${compiledUrl()}`}
          />
          <View style={styles.addressRow}>
            <Button mode="outlined" textColor={colors.text} loading={probing} onPress={() => void test()}>
              Test
            </Button>
            <Button mode="contained" buttonColor={colors.cyan} textColor="#04121A" onPress={() => void save()}>
              Use this address
            </Button>
          </View>
          {address !== compiledUrl() ? (
            <Button mode="text" compact textColor={colors.textMuted} onPress={() => void reset()}>
              Reset to the build default
            </Button>
          ) : null}
          {probe ? (
            <Notice kind={probe.ok ? "success" : "error"} title={probe.ok ? "Reachable" : "Not reachable"}>
              {probe.detail}
            </Notice>
          ) : null}
          {addressSaved ? (
            <Notice kind="success" title="Saved">
              {`Requests now go to ${addressSaved}. Nothing else changed — you are still signed out, so finish signing in against this server.`}
            </Notice>
          ) : null}
        </Panel>
      ) : null}

      {allowDevToken ? (
        <Panel title="Developer: paste a sign-in token" accent={colors.magenta}>
          <Text style={styles.body}>
            Mint one on the backend with `npm run mobile:token -- you@example.com`, then paste it below.
          </Text>
          <Field
            label="Bearer token"
            placeholder="eyJhbGciOiJIUzI1NiIs…"
            autoCapitalize="none"
            autoCorrect={false}
            value={token}
            onChangeText={setToken}
            multiline
          />
          <Button
            mode="outlined"
            textColor={colors.magenta}
            disabled={token.trim().length < 20 || busy}
            onPress={() => void useToken(token)}
          >
            Use this token
          </Button>
        </Panel>
      ) : null}

      <Text style={styles.server}>Backend: {serverUrl()}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: 6, paddingTop: spacing.xl },
  kicker: { color: colors.cyan, fontSize: 11.5, fontWeight: "800", letterSpacing: 2.4 },
  title: { color: colors.text, fontSize: 27, fontWeight: "900", letterSpacing: 0.2 },
  sub: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  body: { color: colors.textMuted, fontSize: 13.5, lineHeight: 20 },
  buttonLabel: { fontSize: 15, paddingVertical: spacing.sm, letterSpacing: 0.6 },
  addressRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  server: { color: colors.borderBright, fontSize: 11.5, textAlign: "center", paddingBottom: spacing.md },
});
