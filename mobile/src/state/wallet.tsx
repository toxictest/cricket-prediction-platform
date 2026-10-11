import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { getWallet } from "../services/wallet";
import { errorMessage } from "../lib/api";
import { MIN_RETAINED_TOKENS } from "../services/withdrawals";
import { useAuth } from "./auth";
import type { WalletBalances } from "../types/api";

/* ==========================================================================
   WALLET STATE
   ==========================================================================

   One place holds the four balance numbers, because after a deposit claim or a
   payout request *several* screens have to change: the wallet tab, the add-money
   success card and the profile snapshot. If each fetched on its own, the app would
   show two different balances a second apart and the member would reasonably
   assume their money was lost somewhere in between.

   `refresh({ silent: true })` is for the poll and for focus: an error there is not
   worth replacing a visible, still-plausible number with an error screen. A
   pull-to-refresh uses the loud version.
   ========================================================================== */

type WalletValue = {
  wallet: WalletBalances | null;
  /** True until the first attempt of the session finishes, success or not. */
  loading: boolean;
  settled: boolean;
  error: string | null;
  refreshing: boolean;
  /** Winning tokens the member may actually take out right now. */
  withdrawable: number;
  /**
   * Client-side preview of the server's retained floor. It exists so the withdraw
   * form can warn before a submit; the server is still the one that decides, and
   * when the two ever disagree the server's message is what the member sees.
   */
  canWithdraw: (amount: number) => boolean;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
};

const WalletContext = createContext<WalletValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { status, overview } = useAuth();
  const [wallet, setWallet] = useState<WalletBalances | null>(null);
  const [loading, setLoading] = useState(true);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      setWallet(await getWallet());
      setError(null);
    } catch (thrown) {
      if (!silent) setError(errorMessage(thrown, "Could not load your wallet."));
    } finally {
      inFlight.current = false;
      setLoading(false);
      setSettled(true);
      setRefreshing(false);
    }
  }, []);

  // The sign-in snapshot already carries a wallet. Take it so the first paint has
  // numbers, then confirm it with a read of its own: a token from thirty days ago
  // should not get to display thirty-day-old money.
  useEffect(() => {
    if (overview?.wallet) setWallet(overview.wallet);
  }, [overview]);

  useEffect(() => {
    if (status === "signedIn") void refresh({ silent: true });
    if (status === "signedOut") {
      setWallet(null);
      setSettled(false);
      setLoading(false);
    }
  }, [status, refresh]);

  useFocusEffect(
    useCallback(() => {
      if (status === "signedIn") void refresh({ silent: true });
    }, [status, refresh]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && status === "signedIn") void refresh({ silent: true });
    });
    return () => subscription.remove();
  }, [status, refresh]);

  const value = useMemo<WalletValue>(
    () => ({
      wallet,
      loading,
      settled,
      error,
      refreshing,
      withdrawable: wallet?.withdrawableBalance ?? 0,
      canWithdraw: (amount: number) =>
        Number.isInteger(amount) &&
        amount > 0 &&
        (wallet?.winningBalance ?? 0) - amount >= MIN_RETAINED_TOKENS,
      refresh,
    }),
    [wallet, loading, settled, error, refreshing, refresh],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside <WalletProvider>");
  return value;
}
