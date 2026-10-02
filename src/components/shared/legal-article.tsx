import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type LegalSection = {
  id: string;
  heading: string;
  body: ReactNode;
};

/**
 * Long-form document renderer for the policy routes.
 *
 * Generates a sticky table of contents from the section list, so adding a
 * section automatically adds its anchor link.
 */
export function LegalArticle({
  eyebrow,
  title,
  updatedAt,
  intro,
  sections,
  footer,
}: {
  eyebrow: string;
  title: string;
  updatedAt: string;
  intro: string;
  sections: LegalSection[];
  footer?: ReactNode;
}) {
  return (
    <div className="container">
      {/* ---------------- header ---------------- */}
      <header className="max-w-3xl">
        <Badge variant="default">{eyebrow}</Badge>

        <h1 className="mt-5 text-balance font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-[2.75rem]">
          {title}
        </h1>

        <p className="mt-4 text-pretty text-[15px] leading-relaxed text-zinc-400">
          {intro}
        </p>

        <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
          Last updated · {updatedAt}
        </p>

        <div className="mt-8 h-px w-40 bg-gradient-to-r from-red-500/60 to-transparent" />
      </header>

      {/* ---------------- body ---------------- */}
      <div className="mt-12 grid gap-12 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-16">
        {/* toc */}
        <nav aria-label="On this page" className="lg:sticky lg:top-28 lg:self-start">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-red-500/80">
            On this page
          </p>
          <ol className="mt-4 space-y-2.5 border-l border-white/[0.08] pl-4">
            {sections.map((section, index) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className={cn(
                    "group flex gap-2.5 text-[13px] leading-snug text-zinc-500",
                    "transition-colors duration-250 hover:text-white",
                  )}
                >
                  <span className="font-mono text-[10px] text-red-500/50 transition-colors group-hover:text-red-400">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {section.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {/* sections */}
        <article className="min-w-0 max-w-3xl space-y-10">
          {sections.map((section, index) => (
            <section key={section.id} id={section.id} className="scroll-mt-28">
              <h2 className="flex items-baseline gap-3 font-display text-lg font-bold text-white sm:text-xl">
                <span className="font-mono text-xs text-red-500/70">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {section.heading}
              </h2>

              <div className="mt-4 space-y-4 text-[14.5px] leading-relaxed text-zinc-400 [&_a]:text-red-400 [&_a]:underline-offset-4 hover:[&_a]:underline [&_code]:rounded [&_code]:bg-black/50 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-amber-200 [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-zinc-200 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
                {section.body}
              </div>

              <div className="mt-8 h-px bg-gradient-to-r from-white/[0.08] to-transparent" />
            </section>
          ))}

          {footer && (
            <div className="rounded-lg glass neon-border p-6">{footer}</div>
          )}
        </article>
      </div>
    </div>
  );
}

export default LegalArticle;
