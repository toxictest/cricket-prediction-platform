import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { Hero } from "@/components/sections/hero";
import { Features } from "@/components/sections/features";
import { About } from "@/components/sections/about";
import { HowItWorks } from "@/components/sections/how-it-works";
import { Faq } from "@/components/sections/faq";

/* The final CTA block is below the fold on every breakpoint — split it out of
   the main bundle so the hero can hydrate first. */
const FinalCta = dynamic(
  () => import("@/components/sections/final-cta").then((m) => m.FinalCta),
  {
    loading: () => (
      <div className="container py-24">
        <div className="h-56 rounded-lg border border-white/[0.06] bg-white/[0.015]" />
      </div>
    ),
  },
);

export const metadata: Metadata = {
  title: "Next Generation Cricket Prediction Community",
  description:
    "Register your account and unlock application access. A members-only cricket prediction community with AI match intelligence, live analytics and an Android terminal.",
  alternates: { canonical: "/" },
};

export default async function LandingPage() {
  // Read the session server-side so the hero can greet returning members
  // without a client-side flash.
  const session = await getServerSession(authOptions);

  return (
    <>
      <Navbar />

      <main id="main" className="relative flex-1">
        <Hero />

        <Features />
        <About />
        <HowItWorks />
        <Faq />
        <FinalCta
          isAuthenticated={Boolean(session?.user?.id)}
          memberName={session?.user?.name ?? null}
        />
      </main>

      <Footer />
    </>
  );
}
