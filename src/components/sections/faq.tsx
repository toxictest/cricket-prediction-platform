"use client";

import Link from "next/link";
import { HelpCircle, MessagesSquare } from "lucide-react";
import { faqs } from "@/lib/constants";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/effects/section-heading";
import { Reveal } from "@/components/effects/reveal";
import { cn } from "@/lib/utils";
import { ContactLink } from "@/components/shared/contact-link";

export function Faq() {
  return (
    <section
      id="faq"
      className="relative scroll-mt-24 overflow-hidden py-20 sm:py-24 lg:py-28"
      aria-labelledby="faq-heading"
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-500/25 to-transparent"
      />

      <div className="container relative">
        <SectionHeading
          eyebrow="04 / FAQ"
          title={
            <span id="faq-heading">
              Questions the{" "}
              <span className="text-gradient-fire">gate</span> usually raises
            </span>
          }
          description="Everything about registration, referrals, the APK and what we store about you."
        />

        <div className="mt-14 grid gap-10 lg:grid-cols-[1fr_20rem] lg:gap-12">
          {/* ---------------- accordion ---------------- */}
          <Reveal variant="up" className="min-w-0">
            <Accordion
              type="single"
              collapsible
              defaultValue="faq-0"
              className="space-y-3"
            >
              {faqs.map((faq, index) => (
                <AccordionItem key={faq.question} value={`faq-${index}`}>
                  <AccordionTrigger>
                    <span className="text-left">{faq.question}</span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="pl-6">{faq.answer}</p>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Reveal>

          {/* ---------------- side rail ---------------- */}
          <Reveal variant="right" delay={0.15} className="min-w-0">
            <aside className="lg:sticky lg:top-28 space-y-4">
              <div
                className={cn(
                  "relative overflow-hidden rounded-lg glass-strong neon-border p-6",
                )}
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-red-600/[0.15] blur-[50px]"
                />

                <span className="relative flex h-10 w-10 items-center justify-center rounded-md border border-red-500/35 bg-red-500/10 shadow-[0_0_16px_rgba(239,68,68,0.25)]">
                  <HelpCircle className="h-5 w-5 text-red-400" aria-hidden="true" />
                </span>

                <h3 className="relative mt-4 font-display text-base font-semibold text-white">
                  Still stuck?
                </h3>
                <p className="relative mt-2 text-[13px] leading-relaxed text-zinc-400">
                  Most access problems are one of two things: the account was
                  never provisioned, or the browser is holding a stale session.
                  Signing out and back in clears both.
                </p>

                <div className="relative mt-5 space-y-2">
                  <Link href="/login" className="block">
                    <Button variant="cyber" size="sm" className="w-full">
                      <MessagesSquare aria-hidden="true" />
                      Go to Sign In
                    </Button>
                  </Link>
                  <div className="text-center">
                    <ContactLink
                      kind="contact"
                      subject="FAQ follow-up"
                      className="font-mono text-[10px] uppercase tracking-[0.16em]"
                    />
                  </div>
                </div>
              </div>

              {/* diagnostic readout */}
              <div className="rounded-lg border border-white/[0.07] bg-black/40 p-5">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                  Quick diagnostics
                </p>
                <ul className="mt-4 space-y-3">
                  {[
                    { k: "Session", v: "JWT · 30d" },
                    { k: "Gate", v: "middleware" },
                    { k: "APK", v: "v1.0.0" },
                    { k: "Vendor", v: "Google" },
                  ].map(({ k, v }) => (
                    <li
                      key={k}
                      className="flex items-center justify-between gap-3 border-b border-white/[0.05] pb-2.5 last:border-0 last:pb-0"
                    >
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                        {k}
                      </span>
                      <span className="font-mono text-[11px] font-semibold text-red-400">
                        {v}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export default Faq;
