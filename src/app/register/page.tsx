import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, googleOAuthConfigured } from "@/lib/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/register-form";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const REFERRAL_COOKIE = "cpc_ref";

export const metadata: Metadata = {
  title: "Activate Account",
  description:
    "Register with Google to join the Cricket Prediction Community. Your member record, referral code and Android terminal access are provisioned automatically.",
  alternates: { canonical: "/register" },
};

export const dynamic = "force-dynamic";

function FormSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-28 w-full opacity-70" />
    </div>
  );
}

export default async function RegisterPage() {
  const session = await getServerSession(authOptions);

  // Already a member: nothing to register.
  if (session?.user?.id) {
    redirect("/dashboard");
  }

  const cookieStore = await cookies();
  const referral = cookieStore.get(REFERRAL_COOKIE)?.value ?? null;

  return (
    <AuthShell
      eyebrow="New Registration"
      title={
        <>
          Activate your account and{" "}
          <span className="text-gradient-fire">unlock the build</span>
        </>
      }
      subtitle="One Google sign-in creates your member record, allocates a unique referral code and permanently opens the Android terminal download for your account."
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="rounded-md border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-center text-[13px] text-zinc-400 sm:flex-1">
            Already activated?{" "}
            <Link
              href="/login"
              className="font-semibold text-red-400 underline-offset-4 transition-colors hover:text-red-300 hover:underline"
            >
              Sign in
            </Link>
          </p>
          <Badge variant="success" className="mx-auto shrink-0 sm:mx-0">
            Free forever
          </Badge>
        </div>
      }
      footnote={
        <>
          Registrations create one member record per verified Google account.
          Duplicate emails are merged onto the same profile rather than creating
          a second account.
        </>
      }
    >
      <Suspense fallback={<FormSkeleton />}>
        <RegisterForm
          configured={googleOAuthConfigured}
          initialReferral={referral}
        />
      </Suspense>
    </AuthShell>
  );
}
