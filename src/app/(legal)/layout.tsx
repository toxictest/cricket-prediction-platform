import type { ReactNode } from "react";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";

/**
 * Shared shell for the static policy routes.
 * The `(legal)` group adds no URL segment — these pages live at
 * `/terms`, `/privacy`, `/responsible-play` and `/contact`.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Navbar />
      <main id="main" className="relative flex-1 pb-8 pt-24 sm:pt-28">
        {children}
      </main>
      <Footer />
    </>
  );
}
