"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  ChevronRight,
  Gift,
  Loader2,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { GoogleMark } from "@/components/auth/google-mark";
import {
  SSO_HOLD_MS,
  SSO_TRANSIT_KEY,
  SsoFireOverlay,
} from "@/components/effects/sso-fire-overlay";

/* ==========================================================================
   TYPES
   ========================================================================== */

type ReferralState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "valid"; code: string; referrer: string }
  | { status: "invalid"; message: string };

/* ==========================================================================
   FORM
   ========================================================================== */

export function RegisterForm({
  configured = true,
  initialReferral = null,
}: {
  configured?: boolean;
  initialReferral?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();

  const [pending, setPending] = useState(false);
  const [transit, setTransit] = useState(false);
  const watchdogRef = useRef<number | null>(null);

  const [referral, setReferral] = useState(initialReferral ?? "");
  const [referralState, setReferralState] = useState<ReferralState>(
    initialReferral ? { status: "checking" } : { status: "idle" },
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";

  /* ---- already signed in ---- */
  useEffect(() => {
    if (status === "authenticated" && session?.user?.id) {
      router.replace("/dashboard");
    }
  }, [status, session?.user?.id, router]);

  /* ======================================================================
     REFERRAL VALIDATION (debounced)
     ====================================================================== */
  const checkReferral = useCallback(async (raw: string) => {
    const code = raw.trim().toUpperCase();

    if (code.length === 0) {
      setReferralState({ status: "idle" });
      return;
    }
    if (code.length < 4) {
      setReferralState({
        status: "invalid",
        message: "Codes are at least 4 characters.",
      });
      return;
    }

    setReferralState({ status: "checking" });

    try {
      const response = await fetch(
        `/api/referral?code=${encodeURIComponent(code)}`,
        { method: "GET", cache: "no-store" },
      );
      const payload = await response.json();

      if (payload?.ok) {
        setReferralState({
          status: "valid",
          code: payload.data.code,
          referrer: payload.data.referrerFirstName,
        });
      } else {
        setReferralState({
          status: "invalid",
          message: payload?.error ?? "That code could not be verified.",
        });
      }
    } catch {
      setReferralState({
        status: "invalid",
        message: "Could not reach the server to verify this code.",
      });
    }
  }, []);

  useEffect(() => {
    if (initialReferral) void checkReferral(initialReferral);
  }, [initialReferral, checkReferral]);

  const handleReferralChange = useCallback(
    (value: string) => {
      setReferral(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void checkReferral(value), 480);
    },
    [checkReferral],
  );

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (watchdogRef.current !== null) window.clearTimeout(watchdogRef.current);
    },
    [],
  );

  /* ======================================================================
     PERSIST THE CODE INTO THE HTTPONLY COOKIE BEFORE REDIRECTING
     ----------------------------------------------------------------------
     The cookie is the only channel that survives the round-trip to Google, so
     it must be written before the browser leaves. Done inside the overlay
     window so a slow request never stalls the animation.
     ====================================================================== */
  const persistReferral = useCallback(async (): Promise<boolean> => {
    const code = referral.trim().toUpperCase();
    if (!code) return true;

    try {
      const response = await fetch("/api/referral/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        toast.error("Referral code rejected", {
          description:
            payload?.error ??
            "We could not attach that code. Continuing without it.",
        });
        return false;
      }
      return true;
    } catch {
      // Non-fatal: the user can still register, just without attribution.
      toast.warning("Network hiccup", {
        description: "Retrying without the referral code attached.",
      });
      return false;
    }
  }, [referral]);

  /* ======================================================================
     GOOGLE REGISTRATION
     ----------------------------------------------------------------------
     The referral POST and the transit animation run CONCURRENTLY: the effect
     is timed, the network call is not, so the two are joined with Promise.all
     rather than sequenced. If the request settles early the overlay still
     plays out its full length; if it is slow the redirect simply waits.
     ====================================================================== */
  const handleGoogle = useCallback(async () => {
    if (!configured) {
      toast.error("Google OAuth is not configured", {
        description:
          "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then redeploy. No other sign-up method is enabled.",
        duration: 9000,
      });
      return;
    }

    setPending(true);
    setTransit(true);

    try {
      window.sessionStorage.setItem(SSO_TRANSIT_KEY, String(Date.now()));
    } catch {
      /* storage unavailable — the arrival burst simply will not play */
    }

    watchdogRef.current = window.setTimeout(() => {
      setTransit(false);
      setPending(false);
    }, 12000);

    const persist = referral.trim() ? persistReferral() : Promise.resolve(true);
    const hold = new Promise<void>((resolve) =>
      window.setTimeout(resolve, SSO_HOLD_MS),
    );

    try {
      await Promise.all([persist, hold]);
      await signIn("google", { callbackUrl });
      // `signIn` navigates away; execution normally stops here.
    } catch (caught) {
      console.error("[register] google sign-in failed:", caught);

      if (watchdogRef.current !== null) {
        window.clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
      try {
        window.sessionStorage.removeItem(SSO_TRANSIT_KEY);
      } catch {
        /* no-op */
      }

      toast.error("Could not start Google registration", {
        description:
          "Check your connection and that the redirect URI matches Google Cloud Console.",
      });
      setTransit(false);
      setPending(false);
    }
  }, [configured, referral, persistReferral, callbackUrl]);

  /* ======================================================================
     RENDER
     ====================================================================== */
  return (
    <div className="w-full">
      <SsoFireOverlay
        open={transit}
        caption={
          referral.trim()
            ? "attaching referral · provisioning account"
            : "provisioning your member record"
        }
      />

      {/* ---------------- referral field ---------------- */}
      <div className="mb-6 space-y-2.5">
        <Label htmlFor="referral">
          <span className="flex items-center gap-2">
            <Gift className="h-3.5 w-3.5 text-red-500/70" aria-hidden="true" />
            Referral code{" "}
            <span className="font-normal normal-case tracking-normal text-zinc-600">
              (optional)
            </span>
          </span>
        </Label>

        <div className="relative">
          <Input
            id="referral"
            name="referral"
            value={referral}
            onChange={(event) => handleReferralChange(event.target.value)}
            placeholder="CRC-XXXXXXXX"
            autoComplete="off"
            spellCheck={false}
            className="pr-10 font-mono uppercase tracking-[0.14em] placeholder:tracking-normal placeholder:text-zinc-700"
            aria-invalid={
              referralState.status === "invalid" ? "true" : undefined
            }
            aria-describedby="referral-feedback"
          />

          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
            {referralState.status === "checking" && (
              <Loader2
                className="h-4 w-4 animate-spin text-zinc-500"
                aria-hidden="true"
              />
            )}
            {referralState.status === "valid" && (
              <BadgeCheck
                className="h-4 w-4 text-emerald-400"
                aria-hidden="true"
              />
            )}
            {referralState.status === "invalid" && (
              <X className="h-4 w-4 text-red-500" aria-hidden="true" />
            )}
          </div>
        </div>

        <div id="referral-feedback" aria-live="polite" className="min-h-[1.1rem]">
          <AnimatePresence mode="wait" initial={false}>
            {referralState.status === "valid" && (
              <motion.p
                key="valid"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider text-emerald-400"
              >
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                {referralState.referrer} will be credited
              </motion.p>
            )}
            {referralState.status === "invalid" && (
              <motion.p
                key="invalid"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider text-red-400"
              >
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                {referralState.message}
              </motion.p>
            )}
            {referralState.status === "idle" && (
              <motion.p
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="font-mono text-[10px] uppercase tracking-wider text-zinc-600"
              >
                Leave blank if nobody invited you
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ---------------- primary CTA ---------------- */}
      <Button
        type="button"
        onClick={() => void handleGoogle()}
        disabled={pending || status === "loading"}
        loading={pending}
        loadingText="Contacting Google"
        size="lg"
        variant="cyber"
        className={cn(
          "group relative h-14 w-full gap-3",
          "border border-white/12 bg-white/[0.045] text-zinc-100",
          "font-sans text-[15px] font-medium normal-case tracking-normal",
          "hover:border-red-500/40 hover:bg-white/[0.08]",
          "hover:shadow-[0_0_34px_rgba(239,68,68,0.35)]",
        )}
      >
        <GoogleMark className="h-[18px] w-[18px] shrink-0" />
        <span>Register with Google</span>
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
            No sign-up method is configured
          </p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-400">
            Registration runs through Google only — email and password sign-up
            has been removed. Add{" "}
            <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[11px] text-amber-200">
              GOOGLE_CLIENT_ID
            </code>{" "}
            and{" "}
            <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[11px] text-amber-200">
              GOOGLE_CLIENT_SECRET
            </code>{" "}
            to your environment, then restart. See{" "}
            <span className="font-mono text-[11px] text-zinc-300">
              DEPLOY.md
            </span>
            .
          </p>
        </div>
      )}

      {/* ---------------- what gets stored ---------------- */}
      <div className="mt-6 rounded-md border border-white/[0.07] bg-black/30 p-4">
        <p className="flex items-center gap-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.18em] text-zinc-500">
          <ShieldCheck
            className="h-3.5 w-3.5 text-red-500/70"
            aria-hidden="true"
          />
          Stored on your member record
        </p>
        <ul className="mt-3 grid grid-cols-2 gap-2">
          {["Name", "Email", "Google ID", "Referral code"].map((field) => (
            <li
              key={field}
              className="flex items-center gap-2 font-mono text-[10.5px] text-zinc-400"
            >
              <span className="h-1 w-1 shrink-0 rounded-full bg-red-500/70" />
              {field}
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-white/[0.06] pt-3 font-mono text-[9.5px] leading-relaxed text-zinc-600">
          Passwords are never collected or stored — authentication is fully
          delegated to Google. Profile pictures are fetched from Google&rsquo;s
          CDN and never re-uploaded.
        </p>
      </div>

      {/* ---------------- members-only note ---------------- */}
      <div className="mt-5 flex items-center justify-center gap-2">
        <Badge variant="neon">Google SSO only</Badge>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-zinc-600">
          one account per verified email
        </span>
      </div>
    </div>
  );
}

export default RegisterForm;
