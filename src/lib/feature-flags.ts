/* ==========================================================================
   FEATURE FLAGS
   ==========================================================================

   One place decides whether a guarded area of the product is reachable. Flags
   are read per call, not cached at module load, so a test can change the
   environment and a long-lived server picks up a redeploy cleanly.

   `MONEY_MODE` is the legal gate described in docs/SYSTEM_DESIGN.md §2 (rule
   G1): deposits, deposit reviews, and anything that converts rupees into
   wallet tokens. The app must not expose those endpoints in production until
   counsel has signed off, so an unset flag means "on in development and test,
   off in production".
   ========================================================================== */

const TRUTHY = new Set(["1", "true", "on", "yes", "enabled"]);
const FALSY = new Set(["0", "false", "off", "no", "disabled", ""]);

/**
 * True when money endpoints may run.
 *
 *   MONEY_MODE = "true" | "1" | "on" | "yes" | "enabled"   -> on
 *   MONEY_MODE = "false" | "0" | "off" | "no" | ""         -> off
 *   MONEY_MODE unset or unrecognised                       -> on outside
 *                                                             production, off in
 *                                                             production
 */
export function moneyModeEnabled(): boolean {
  const raw = process.env.MONEY_MODE;

  if (raw !== undefined) {
    const value = raw.trim().toLowerCase();
    if (TRUTHY.has(value)) return true;
    if (FALSY.has(value)) return false;
    console.warn(
      `[feature-flags] MONEY_MODE="${raw}" is not a recognised value. Falling back to the environment default.`,
    );
  }

  return process.env.NODE_ENV !== "production";
}

/** Shown to a client when the gate is closed. Keep it neutral: no legal commentary over the wire. */
export const MONEY_MODE_OFF_MESSAGE =
  "Money features are currently unavailable. Please try again later.";
