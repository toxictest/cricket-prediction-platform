import React from "react";
import { Redirect, Slot } from "expo-router";
import { useAuth } from "../../src/state/auth";

/**
 * The one guard for everything that belongs to a signed-in member.
 *
 * It checks the app's auth *state*, not the presence of a token, because "booting"
 * is a real third answer: redirecting while a stored credential is still being
 * verified would throw a signed-in member out to the login screen on every cold
 * start, which is how people conclude an app "loses" their session.
 */
export default function ProtectedLayout() {
  const { status } = useAuth();
  if (status === "booting") return null;
  if (status === "signedOut") return <Redirect href="/login" />;
  // `Slot` is what renders the screens inside this group — a guard that returns
  // null here would hide the whole app while still counting as "signed in".
  return <Slot />;
}
