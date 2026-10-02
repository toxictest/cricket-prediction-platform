import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { ShieldCheck } from "lucide-react";
import { authOptions, googleOAuthConfigured } from "@/lib/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { AccessNotice } from "@/components/auth/access-notice";
import { Skeleton } from "@/components/ui/skeleton";

const REFERRAL_COOKIE = "cpc_ref";

export const metadata: Metadata = {
  title: "Sign In",
  description:
    "Sign in to the Cricket Prediction Community with Google to access your dashboard and the Android terminal download.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/login" },
};

export const dynamic = "force-dynamic";

/* ==========================================================================
   FALLBACK
   ========================================================================== */

function FormSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-3 w-3/5 mx-auto" />
      <Skeleton className="h-11 w-full opacity-60" />
    </div>
  );
}

/* ==========================================================================
   PAGE
   ========================================================================== */

/** Routes the middleware protects — used to explain *why* the user landed here. */
const GATED_ROUTES = ["/download", "/dashboard", "/downloads"];

function gatedRouteFrom(searchParams: Record<string, string | string[] | undefined>) {
  const raw = searchParams.callbackUrl;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;

  // Only treat same-origin relative paths as a gated destination.
  if (!value.startsWith("/") || value.startsWith("//")) return null;

  const path = value.split("?")[0] ?? value;
  return GATED_ROUTES.some(
    (route) => path === route || path.startsWith(`${route}/`),
  )
    ? path
    : null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Already authenticated? Straight to the dashboard — no form flash.
  const session = await getServerSession(authOptions);
  if (session?.user?.id) {
    redirect("/dashboard");
  }

  const cookieStore = await cookies();
  const referral = cookieStore.get(REFERRAL_COOKIE)?.value ?? null;

  const params = await searchParams;
  const gatedRoute = gatedRouteFrom(params);

  return (
    <AuthShell
      eyebrow="Access Terminal"
      title={
        <>
          Welcome back to the{" "}
          <span className="text-gradient-fire">network</span>
        </>
      }
      subtitle="Authenticate with the same Google account you registered with. Your member record, referral code and download history are restored instantly."
      footer={
        <div className="rounded-md border border-white/[0.07] bg-white/[0.02] px-4 py-3.5 text-center">
          <p className="text-[13px] text-zinc-400">
            No account yet?{" "}
            <Link
              href="/register"
              className="font-semibold text-red-400 underline-offset-4 transition-colors hover:text-red-300 hover:underline"
            >
              Activate your account
            </Link>
          </p>
        </div>
      }
      footnote={
        <>
          By signing in you agree to the{" "}
          <Link href="/terms" className="text-zinc-500 underline-offset-2 hover:text-red-400 hover:underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-zinc-500 underline-offset-2 hover:text-red-400 hover:underline">
            Privacy Policy
          </Link>
          . Accounts are for 18+ users.
        </>
      }
    >
      {/* `useSearchParams` needs a Suspense boundary for static prerendering */}
      <Suspense fallback={<FormSkeleton />}>
        <>
          {/* Explains why the middleware bounced the visitor here. */}
          {gatedRoute && <AccessNotice requestedPath={gatedRoute} className="mb-6" />}

          <LoginForm
            configured={googleOAuthConfigured}
            referralFromCookie={referral}
          />
        </>
      </Suspense>

      {/* Screen-reader hint that a full-page redirect is expected */}
      <p className="sr-only">
        <ShieldCheck aria-hidden="true" />
        Selecting &ldquo;Continue with Google&rdquo; redirects you to Google to
        authorise access, then returns you to this site.
      </p>
    </AuthShell>
  );
}
