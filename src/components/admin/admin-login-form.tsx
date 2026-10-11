"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronRight, KeyRound, Lock, ShieldCheck, User2 } from "lucide-react";
import { toast } from "sonner";
import { adminCall } from "@/lib/admin-client";
import { ADMIN_HOME_PATH } from "@/lib/admin-paths";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/admin/admin-primitives";

/* ==========================================================================
   STAFF SIGN-IN FORM
   ==========================================================================

   Talks to `POST /api/admin/login`, which owns the throttling (10 attempts per
   account per 15 minutes, 30 per IP), the bcrypt check and the session cookie.
   This component only decides what the operator sees for each outcome — including
   a cooldown after a 429, because the server has already told us to wait and a
   retry that fast is the behaviour the limiter exists to stop.
   ========================================================================== */

export function AdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || cooldown > 0) return;

    setPending(true);
    setFailure(null);

    const result = await adminCall<{ admin?: { name?: string } }>("/api/admin/login", {
      body: { email, password },
    });

    if (result.ok) {
      toast.success("Signed in", {
        description: `Welcome back${result.data?.admin?.name ? `, ${result.data.admin.name}` : ""}.`,
      });
      router.replace(ADMIN_HOME_PATH);
      router.refresh();
      return;
    }

    setPending(false);
    setFailure(result.error);

    if (result.code === "RATE_LIMITED") {
      setCooldown(30);
      toast.error("Too many attempts", {
        description: "Sign-in is paused for a moment. Check the password before trying again.",
        duration: 8000,
      });
      return;
    }

    if (result.status === 401) {
      // The endpoint answers an unknown account and a wrong password identically,
      // on purpose. So does this form.
      toast.error("Sign-in refused", { description: result.error });
      return;
    }

    toast.error("Could not sign in", { description: result.error, duration: 8000 });
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {failure && (
        <div role="alert" className="flex items-start gap-3 rounded-md border border-red-500/40 bg-red-500/[0.08] p-3.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-red-300">
              Not signed in
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-300">{failure}</p>
          </div>
        </div>
      )}

      <Field label="Work email" htmlFor="admin-email">
        <div className="relative">
          <User2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" aria-hidden="true" />
          <Input
            id="admin-email"
            name="email"
            type="email"
            autoComplete="username"
            required
            terminal
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@yourdomain.com"
            className="pl-9"
          />
        </div>
      </Field>

      <Field label="Password" htmlFor="admin-password">
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" aria-hidden="true" />
          <Input
            id="admin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••••••"
            className="pl-9"
          />
        </div>
      </Field>

      <Button
        type="submit"
        variant="neon"
        className="group h-12 w-full"
        loading={pending}
        loadingText="Verifying"
        disabled={cooldown > 0 || !email || !password}
      >
        {cooldown > 0 ? (
          <>Wait {cooldown}s</>
        ) : (
          <>
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Enter control panel
            <ChevronRight
              className="ml-auto h-4 w-4 text-zinc-500 transition-transform duration-300 group-hover:translate-x-1 group-hover:text-red-300"
              aria-hidden="true"
            />
          </>
        )}
      </Button>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-1">
        {[
          { icon: ShieldCheck, label: "bcrypt + 8 h session" },
          { icon: Lock, label: "cookie is HttpOnly, SameSite=strict" },
        ].map(({ icon: Icon, label }) => (
          <span
            key={label}
            className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-zinc-600"
          >
            <Icon className="h-3 w-3 text-red-500/60" aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>
    </form>
  );
}
