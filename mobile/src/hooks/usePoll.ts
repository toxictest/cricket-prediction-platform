import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect, useIsFocused } from "expo-router";

/*
 * Polling that behaves on a phone.
 *
 * A naive `setInterval` in a screen keeps firing while the app is backgrounded,
 * while the phone is locked, and while the user is on another tab — which for a
 * 12-second score poll means a battery complaint and a stack of requests the
 * backend just answered with 304. So this pauses on all three, and it never lets
 * two requests overlap: a slow response must not queue up behind itself.
 */

export type PollState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** True after the first attempt, success or not — the difference between a spinner and "no matches". */
  settled: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
  lastUpdated: Date | null;
};

export function usePoll<T>(
  load: (signal: { first: boolean }) => Promise<T | null>,
  options: { intervalMs?: number; enabled?: boolean } = {},
): PollState<T> {
  const { intervalMs = 0, enabled = true } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [settled, setSettled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const inFlight = useRef(false);
  const mounted = useRef(true);
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (kind: "initial" | "manual" | "poll") => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (kind === "manual") setRefreshing(true);
      else if (kind === "initial") setLoading(true);

      try {
        const next = await loader.current({ first: kind === "initial" });
        if (!mounted.current) return;
        // A poll that answers "nothing changed" (null) must not blank the screen.
        if (next !== null) setData(next);
        setError(null);
        setLastUpdated(new Date());
      } catch (thrown) {
        if (!mounted.current) return;
        setError(thrown instanceof Error ? thrown.message : "Could not load this.");
      } finally {
        inFlight.current = false;
        if (mounted.current) {
          setLoading(false);
          setSettled(true);
          setRefreshing(false);
        }
      }
    },
    [],
  );

  const focused = useIsFocused();
  const appState = useRef(AppState.currentState);
  const [foreground, setForeground] = useState(appState.current === "active");

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      appState.current = next;
      setForeground(next === "active");
      // Coming back to the app is the moment a stale number looks like a lie.
      if (next === "active") void run("manual");
    });
    return () => subscription.remove();
  }, [run]);

  const live = enabled && focused && foreground;

  // First mount, and every return to this screen.
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      void run("initial");
    }, [enabled, run]),
  );

  useEffect(() => {
    if (!live || intervalMs <= 0) return;
    const timer = setInterval(() => void run("poll"), intervalMs);
    return () => clearInterval(timer);
  }, [live, intervalMs, run]);

  return {
    data,
    error,
    loading,
    settled,
    refreshing,
    lastUpdated,
    refresh: () => run("manual"),
  };
}
