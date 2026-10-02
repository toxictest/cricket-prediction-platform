"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Flame,
  Lock,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GoogleMark } from "@/components/auth/google-mark";
import {
  SSO_HOLD_MS,
  SSO_TRANSIT_KEY,
  SsoFireOverlay,
} from "@/components/effects/sso-fire-overlay";

/* ==========================================================================
   ERROR MESSAGES
   --------------------------------------------------------------------------
   Google OAuth is the only sign-in path, so every branch a user can reach is
   an OAuth branch. The copy names the actual fix rather than "an error
   occurred".
   ========================================================================== */

const ERROR_MESSAGES: Record<string, { title: string; detail: string }> = {
  Configuration: {
    title: "Authentication is misconfigured",
    detail:
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are missing or NEXTAUTH_SECRET is unset. Check your environment variables and redeploy.",
  },
  AccessDenied: {
    title: "Access denied",
    detail:
      "This Google account was blocked, or the consent screen was cancelled.",
  },
  OAuthAccountNotLinked: {
    title: "Account already linked elsewhere",
    detail:
      "That email is already registered with a different sign-in method. Use the original method.",
  },
  OAuthSignin: {
    title: "Could not reach Google",
    detail:
      "The OAuth handshake failed before it started. Check your network and retry.",
  },
  OAuthCallback: {
    title: "Google callback rejected",
    detail:
      "The redirect URI does not match the one registered in Google Cloud Console. It must be exactly {origin}/api/auth/callback/google.",
  },
  OAuthCreateAccount: {
    title: "Account provisioning failed",
    detail:
      "Google authenticated you, but we could not write your member record to PostgreSQL. Check that the database is reachable.",
  },
  Callback: {
    title: "Session handshake failed",
    detail: "Something went wrong while finalising your session. Please retry.",
  },
  CredentialsSignin: {
    title: "Sign-in rejected",
    detail:
      "This build accepts Google accounts only. Email and password sign-in has been removed.",
  },
  SessionRequired: {
    title: "Sign in required",
    detail: "That page is members-only. Authenticate to continue.",
  },
  Verification: {
    title: "Verification link expired",
    detail: "Request a fresh sign-in attempt.",
  },
  Default: {
    title: "Sign-in failed",
    detail: "An unexpected error occurred. Please try again.",
  },
};

/* ==========================================================================
   FORM
   ========================================================================== */

export function LoginForm({
  configured = true,
  referralFromCookie = null,
}: {
  /** False when GOOGLE_CLIENT_ID / SECRET are absent. */
  configured?: boolean;
  referralFromCookie?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();

  const [pending, setPending] = useState(false);
  const [transit, setTransit] = useState(false);
  const watchdogRef = useRef<number | null>(null);

  /* ---- resolve the post-login destination ---- */
  const callbackUrl = useMemo(() => {
    const raw = searchParams.get("callbackUrl");
    // Only same-origin relative paths are honoured — mirrors the server-side
    // `redirect` callback and blocks open-redirect attempts.
    if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
    return "/dashboard";
  }, [searchParams]);

  const errorCode = searchParams.get("error");
  const error = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.Default!)
    : null;

  /* ---- surface the OAuth error as a toast once ---- */
  useEffect(() => {
    if (!error) return;

    // A failed or cancelled handshake leaves the transit flag behind. Clearing
    // it here stops a stale "ACCESS GRANTED" burst from firing on a later,
    // unrelated visit to the dashboard.
    try {
      window.sessionStorage.removeItem(SSO_TRANSIT_KEY);
    } catch {
      /* storage unavailable — nothing to clean */
    }

    toast.error(error.title, { description: error.detail, duration: 8000 });
  }, [error]);

  /* ---- already signed in? bounce to the destination ---- */
  useEffect(() => {
    if (status === "authenticated" && session?.user?.id) {
      router.replace(callbackUrl);
    }
  }, [status, session?.user?.id, router, callbackUrl]);

  /* ---- clear the watchdog if we unmount mid-handshake ---- */
  useEffect(
    () => () => {
      if (watchdogRef.current !== null) {
        window.clearTimeout(watchdogRef.current);
      }
    },
    [],
  );

  /* ======================================================================
     GOOGLE SSO
     ----------------------------------------------------------------------
     Two timed steps:
       1. Play the fire-transit overlay for SSO_HOLD_MS.
       2. Hand off to NextAuth, which does a full-page redirect to Google.

     The delay is the feature: it gives the handshake a visible state change
     instead of a hard jump, and it is short enough (≈2s) to feel responsive.
     ====================================================================== */
  const handleGoogle = useCallback(() => {
    if (!configured) {
      toast.error("Google OAuth is not configured", {
        description:
          "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then redeploy. No other sign-in method is enabled.",
        duration: 9000,
      });
      return;
    }

    setPending(true);
    setTransit(true);

    // Hand the arrival burst its baton. Written BEFORE the redirect because
    // nothing on this page survives the navigation to Google.
    try {
      window.sessionStorage.setItem(SSO_TRANSIT_KEY, String(Date.now()));
    } catch {
      /* storage unavailable — the burst simply will not play */
    }

    // If the redirect never fires (popup blocker, offline, thrown error), the
    // UI must not stay frozen behind an overlay forever.
    watchdogRef.current = window.setTimeout(() => {
      setTransit(false);
      setPending(false);
    }, 12000);

    window.setTimeout(async () => {
      try {
        await signIn("google", { callbackUrl });
        // `signIn` navigates away; execution normally stops here.
      } catch (caught) {
        console.error("[login] google sign-in failed:", caught);

        if (watchdogRef.current !== null) {
          window.clearTimeout(watchdogRef.current);
          watchdogRef.current = null;
        }
        try {
          window.sessionStorage.removeItem(SSO_TRANSIT_KEY);
        } catch {
          /* no-op */
        }

        toast.error("Could not start Google sign-in", {
          description:
            "Check your connection and that the redirect URI matches Google Cloud Console.",
        });
        setTransit(false);
        setPending(false);
      }
    }, SSO_HOLD_MS);
  }, [configured, callbackUrl]);

  /* ======================================================================
     RENDER
     ====================================================================== */
  return (
    <div className="w-full">
      {/* the transit effect — rendered above everything, incl. this form */}
      <SsoFireOverlay
        open={transit}
        caption="redirecting to accounts.google.com"
      />

      {/* ---------------- error banner ---------------- */}
      <AnimatePresence initial={false}>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: "auto", marginBottom: 20 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div
              role="alert"
              className={cn(
                "flex items-start gap-3 rounded-md border border-red-500/40",
                "bg-red-500/[0.08] p-4",
              )}
            >
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-red-300">
                  {error.title}
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">
                  {error.detail}
                </p>
                <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-red-500/60">
                  code: {errorCode}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- referral notice ---------------- */}
      {referralFromCookie && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5 flex items-center gap-2.5 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-3.5 py-2.5"
        >
          <CheckCircle2
            className="h-4 w-4 shrink-0 text-emerald-400"
            aria-hidden="true"
          />
          <p className="font-mono text-[10.5px] uppercase tracking-wider text-emerald-300">
            Referral code captured:{" "}
            <span className="font-bold">{referralFromCookie}</span>
          </p>
        </motion.div>
      )}

      {/* ---------------- Google ---------------- */}
      <Button
        type="button"
        onClick={handleGoogle}
        disabled={pending || status === "loading"}
        loading={pending}
        loadingText="Contacting Google"
        className={cn(
          "group relative h-14 w-full gap-3 overflow-visible",
          "border border-white/12 bg-white/[0.045] text-zinc-100",
          "font-sans text-[15px] font-medium normal-case tracking-normal",
          "hover:border-red-500/40 hover:bg-white/[0.08]",
          "hover:shadow-[0_0_34px_rgba(239,68,68,0.35)]",
        )}
        size="lg"
        variant="cyber"
      >
        <GoogleMark className="h-[18px] w-[18px] shrink-0" />
        <span>Continue with Google</span>
        <ChevronRight
          className="ml-auto h-4 w-4 text-zinc-500 transition-transform duration-300 group-hover:translate-x-1 group-hover:text-red-400"
          aria-hidden="true"
        />
      </Button>

      {/* ---------------- no-credentials warning ---------------- */}
      {!configured && (
        <div className="mt-4 rounded-md border border-red-500/35 bg-red-500/[0.07] p-4">
          <p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider text-red-300">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            No sign-in method is configured
          </p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-400">
            This build authenticates with Google only — email and password
            sign-in has been removed. Add{" "}
            <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[11px] text-amber-200">
              GOOGLE_CLIENT_ID
            </code>{" "}
            and{" "}
            <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[11px] text-amber-200">
              GOOGLE_CLIENT_SECRET
            </code>{" "}
            to your environment, then restart. See{" "}
            <span className="font-mono text-[11px] text-zinc-300">DEPLOY.md</span>
            .
          </p>
        </div>
      )}

      {/* ---------------- fire hint ---------------- */}
      <p className="mt-4 flex items-center justify-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-600">
        <Flame className="h-3 w-3 text-red-500/70" aria-hidden="true" />
        hands off to accounts.google.com
      </p>

      {/* ---------------- trust row ---------------- */}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        {[
          { icon: Lock, label: "No passwords stored" },
          { icon: ShieldCheck, label: "OAuth 2.0" },
          { icon: Terminal, label: "JWT session" },
        ].map(({ icon: Icon, label }) => (
          <span
            key={label}
            className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-zinc-600"
          >
            <Icon className="h-3 w-3 text-red-500/60" aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default LoginForm;
