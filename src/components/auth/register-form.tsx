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
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

/* ==========================================================================
   GOOGLE GLYPH
   ========================================================================== */

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.141 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

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
  demoEnabled = false,
  configured = true,
  initialReferral = null,
}: {
  demoEnabled?: boolean;
  configured?: boolean;
  initialReferral?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();

  const [pending, setPending] = useState<"google" | "developer" | null>(null);
  const [referral, setReferral] = useState(initialReferral ?? "");
  const [referralState, setReferralState] = useState<ReferralState>(
    initialReferral ? { status: "checking" } : { status: "idle" },
  );

  // Developer access
  const [devOpen, setDevOpen] = useState(false);
  const [devEmail, setDevEmail] = useState("");
  const [devName, setDevName] = useState("");
  const [devPassphrase, setDevPassphrase] = useState("");
  const [devError, setDevError] = useState<string | null>(null);

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
    },
    [],
  );

  /* ======================================================================
     PERSIST THE CODE INTO THE HTTPONLY COOKIE BEFORE REDIRECTING
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
     ====================================================================== */
  const handleGoogle = useCallback(async () => {
    if (!configured) {
      toast.error("Google OAuth is not configured", {
        description:
          "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env, then restart the dev server.",
        duration: 9000,
      });
      return;
    }

    setPending("google");

    if (referral.trim()) await persistReferral();

    try {
      await signIn("google", { callbackUrl });
    } catch (caught) {
      console.error("[register] google sign-in failed:", caught);
      toast.error("Could not start Google registration");
      setPending(null);
    }
  }, [configured, referral, persistReferral, callbackUrl]);

  /* ======================================================================
     DEVELOPER REGISTRATION
     ====================================================================== */
  const handleDeveloper = useCallback(async () => {
    setDevError(null);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(devEmail.trim())) {
      setDevError("Enter a valid email address.");
      return;
    }

    setPending("developer");

    try {
      await persistReferral();

      const result = await signIn("developer", {
        email: devEmail.trim().toLowerCase(),
        name: devName.trim(),
        passphrase: devPassphrase,
        redirect: false,
      });

      if (!result || result.error) {
        setDevError(
          result?.error === "INVALID_PASSPHRASE"
            ? "Wrong passphrase. It must match DEMO_LOGIN_PASSWORD in .env."
            : "Provisioning failed. Check the server logs.",
        );
        setPending(null);
        return;
      }

      toast.success("Account provisioned", {
        description: "Your referral code has been generated.",
      });
      router.replace(callbackUrl);
      router.refresh();
    } catch (caught) {
      console.error("[register] developer sign-in failed:", caught);
      setDevError("Unexpected error. Please try again.");
      setPending(null);
    }
  }, [devEmail, devName, devPassphrase, persistReferral, callbackUrl, router]);

  /* ======================================================================
     RENDER
     ====================================================================== */
  return (
    <div className="w-full">
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
              <BadgeCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
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
        onClick={handleGoogle}
        disabled={pending !== null || status === "loading"}
        loading={pending === "google"}
        loadingText="Provisioning account"
        size="lg"
        variant="cyber"
        className={cn(
          "group h-14 w-full gap-3",
          "border border-white/12 bg-white/[0.045] text-zinc-100",
          "font-sans text-[15px] font-medium normal-case tracking-normal",
          "hover:border-white/25 hover:bg-white/[0.08]",
          "hover:shadow-[0_0_26px_rgba(239,68,68,0.25)]",
        )}
      >
        <GoogleMark className="h-[18px] w-[18px] shrink-0" />
        <span>Register with Google</span>
        <ChevronRight
          className="ml-auto h-4 w-4 text-zinc-500 transition-transform duration-300 group-hover:translate-x-1 group-hover:text-red-400"
          aria-hidden="true"
        />
      </Button>

      {/* ---------------- what gets stored ---------------- */}
      <div className="mt-6 rounded-md border border-white/[0.07] bg-black/30 p-4">
        <p className="flex items-center gap-2 font-mono text-[9.5px] font-bold uppercase tracking-[0.18em] text-zinc-500">
          <ShieldCheck className="h-3.5 w-3.5 text-red-500/70" aria-hidden="true" />
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

      {/* ==================================================================
          DEVELOPER ACCESS
          ================================================================== */}
      {demoEnabled && (
        <>
          <div className="my-7 flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-zinc-600">
              or
            </span>
            <Separator className="flex-1" />
          </div>

          <AnimatePresence initial={false} mode="wait">
            {!devOpen ? (
              <motion.div
                key="closed"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => setDevOpen(true)}
                >
                  <KeyRound aria-hidden="true" />
                  Developer Access
                </Button>
                <p className="mt-3 text-center font-mono text-[9.5px] uppercase tracking-[0.14em] text-zinc-600">
                  Local testing only · disabled in production
                </p>
              </motion.div>
            ) : (
              <motion.form
                key="open"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleDeveloper();
                }}
              >
                <div className="space-y-4 rounded-md border border-amber-500/25 bg-amber-500/[0.03] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <Badge variant="warning">
                      <KeyRound aria-hidden="true" />
                      Bypass channel
                    </Badge>
                    <button
                      type="button"
                      onClick={() => {
                        setDevOpen(false);
                        setDevError(null);
                      }}
                      className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 transition-colors hover:text-red-400"
                    >
                      cancel
                    </button>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reg-email">Member email</Label>
                    <div className="relative">
                      <Mail
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600"
                        aria-hidden="true"
                      />
                      <Input
                        id="reg-email"
                        type="email"
                        inputMode="email"
                        placeholder="newmember@example.com"
                        className="pl-10"
                        terminal
                        value={devEmail}
                        onChange={(event) => setDevEmail(event.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reg-name">Display name</Label>
                    <div className="relative">
                      <User
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600"
                        aria-hidden="true"
                      />
                      <Input
                        id="reg-name"
                        type="text"
                        placeholder="Test Analyst"
                        className="pl-10"
                        value={devName}
                        onChange={(event) => setDevName(event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reg-pass">Access passphrase</Label>
                    <div className="relative">
                      <Lock
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600"
                        aria-hidden="true"
                      />
                      <Input
                        id="reg-pass"
                        type="password"
                        placeholder="DEMO_LOGIN_PASSWORD"
                        className="pl-10"
                        terminal
                        value={devPassphrase}
                        onChange={(event) => setDevPassphrase(event.target.value)}
                      />
                    </div>
                  </div>

                  {devError && (
                    <p
                      role="alert"
                      className="flex items-start gap-2 rounded border border-red-500/35 bg-red-500/[0.07] px-3 py-2 text-[12.5px] text-red-300"
                    >
                      <AlertTriangle
                        className="mt-0.5 h-3.5 w-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      {devError}
                    </p>
                  )}

                  <Button
                    type="submit"
                    variant="outline"
                    className="w-full"
                    loading={pending === "developer"}
                    loadingText="Creating account"
                  >
                    <KeyRound aria-hidden="true" />
                    Create Member Record
                  </Button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

export default RegisterForm;
