"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
  Terminal,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

/* ==========================================================================
   ERROR MESSAGES
   ========================================================================== */

const ERROR_MESSAGES: Record<string, { title: string; detail: string }> = {
  Configuration: {
    title: "Authentication is misconfigured",
    detail:
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are missing or NEXTAUTH_SECRET is unset. Check your .env file.",
  },
  AccessDenied: {
    title: "Access denied",
    detail:
      "This Google account was blocked, or the sign-in attempt was cancelled.",
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
    title: "Invalid credentials",
    detail: "The passphrase or email address was not accepted.",
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
  INVALID_PASSPHRASE: {
    title: "Wrong passphrase",
    detail: "The developer access passphrase does not match DEMO_LOGIN_PASSWORD.",
  },
  INVALID_EMAIL: {
    title: "Invalid email",
    detail: "Enter a well-formed email address.",
  },
};

/* ==========================================================================
   GOOGLE GLYPH (inline SVG — matches the official mark, no network request)
   ========================================================================== */

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
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
   FORM
   ========================================================================== */

type Mode = "google" | "developer";

export function LoginForm({
  demoEnabled = false,
  configured = true,
  referralFromCookie = null,
}: {
  demoEnabled?: boolean;
  /** False when GOOGLE_CLIENT_ID / SECRET are absent. */
  configured?: boolean;
  referralFromCookie?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();

  const [pending, setPending] = useState<Mode | null>(null);
  const [devOpen, setDevOpen] = useState(false);
  const [devPending, setDevPending] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);

  const [devEmail, setDevEmail] = useState("");
  const [devName, setDevName] = useState("");
  const [devPassphrase, setDevPassphrase] = useState("");

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
    if (error) {
      toast.error(error.title, { description: error.detail, duration: 8000 });
    }
  }, [error]);

  /* ---- already signed in? bounce to the destination ---- */
  useEffect(() => {
    if (status === "authenticated" && session?.user?.id) {
      router.replace(callbackUrl);
    }
  }, [status, session?.user?.id, router, callbackUrl]);

  /* ======================================================================
     GOOGLE
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
    try {
      await signIn("google", { callbackUrl });
      // `signIn` performs a full-page redirect; execution normally stops here.
    } catch (caught) {
      console.error("[login] google sign-in failed:", caught);
      toast.error("Could not start Google sign-in", {
        description:
          "Check your connection and that the redirect URI matches Google Cloud Console.",
      });
      setPending(null);
    }
  }, [configured, callbackUrl]);

  /* ======================================================================
     DEVELOPER ACCESS
     ====================================================================== */
  const handleDeveloper = useCallback(async () => {
    setDevError(null);

    if (!devEmail.trim()) {
      setDevError("Email is required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(devEmail.trim())) {
      setDevError("Enter a valid email address.");
      return;
    }

    setDevPending(true);
    setPending("developer");

    try {
      const result = await signIn("developer", {
        email: devEmail.trim().toLowerCase(),
        name: devName.trim(),
        passphrase: devPassphrase,
        redirect: false,
      });

      if (!result || result.error) {
        const code = result?.error ?? "CredentialsSignin";
        const message = ERROR_MESSAGES[code] ?? ERROR_MESSAGES.Default!;
        setDevError(message.detail);
        toast.error(message.title, { description: message.detail });
        setDevPending(false);
        setPending(null);
        return;
      }

      toast.success("Member session established");
      router.replace(callbackUrl);
      router.refresh();
    } catch (caught) {
      console.error("[login] developer sign-in failed:", caught);
      setDevError("Unexpected error. Check the server logs.");
      setDevPending(false);
      setPending(null);
    }
  }, [devEmail, devName, devPassphrase, callbackUrl, router]);

  /* ======================================================================
     RENDER
     ====================================================================== */
  return (
    <div className="w-full">
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
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
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
        disabled={pending !== null || status === "loading"}
        loading={pending === "google"}
        loadingText="Redirecting to Google"
        className={cn(
          "group h-14 w-full gap-3",
          "border border-white/12 bg-white/[0.045] text-zinc-100",
          "font-sans text-[15px] font-medium normal-case tracking-normal",
          "hover:border-white/25 hover:bg-white/[0.08]",
          "hover:shadow-[0_0_26px_rgba(239,68,68,0.25)]",
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

      {/* ---------------- Google setup hint ---------------- */}
      {!configured && (
        <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-3.5">
          <p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            OAuth credentials missing
          </p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-400">
            Add{" "}
            <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[11px] text-amber-200">
              GOOGLE_CLIENT_ID
            </code>{" "}
            and{" "}
            <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[11px] text-amber-200">
              GOOGLE_CLIENT_SECRET
            </code>{" "}
            to{" "}
            <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[11px] text-amber-200">
              .env
            </code>
            . Until then, use Developer Access below to exercise the full flow.
          </p>
        </div>
      )}

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
                  size="default"
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
                    <Label htmlFor="dev-email">Member email</Label>
                    <div className="relative">
                      <Mail
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600"
                        aria-hidden="true"
                      />
                      <Input
                        id="dev-email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        placeholder="analyst@example.com"
                        className="pl-10"
                        terminal
                        value={devEmail}
                        onChange={(event) => setDevEmail(event.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="dev-name">
                      Display name{" "}
                      <span className="text-zinc-600">(optional)</span>
                    </Label>
                    <div className="relative">
                      <User
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600"
                        aria-hidden="true"
                      />
                      <Input
                        id="dev-name"
                        type="text"
                        autoComplete="name"
                        placeholder="Test Analyst"
                        className="pl-10"
                        value={devName}
                        onChange={(event) => setDevName(event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="dev-pass">Access passphrase</Label>
                    <div className="relative">
                      <Lock
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600"
                        aria-hidden="true"
                      />
                      <Input
                        id="dev-pass"
                        type="password"
                        autoComplete="current-password"
                        placeholder="DEMO_LOGIN_PASSWORD"
                        className="pl-10"
                        terminal
                        value={devPassphrase}
                        onChange={(event) => setDevPassphrase(event.target.value)}
                      />
                    </div>
                    <p className="font-mono text-[9.5px] leading-relaxed text-zinc-600">
                      Default in .env.example: cyber-demo-2026
                    </p>
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
                    loading={devPending}
                    loadingText="Provisioning"
                  >
                    <KeyRound aria-hidden="true" />
                    Enter Terminal
                  </Button>

                  <p className="font-mono text-[9.5px] leading-relaxed text-zinc-600">
                    This authenticates through NextAuth&rsquo;s credentials
                    provider and writes a real row to PostgreSQL — the same
                    code path as Google.
                  </p>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

export default LoginForm;
