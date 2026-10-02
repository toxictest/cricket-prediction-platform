"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

/**
 * Single client boundary for the whole app.
 *
 * Keeping every context provider here means the root layout can stay a Server
 * Component and only this thin shell ships to the browser.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider
      // Revalidate the session when the tab regains focus so referral counts
      // and membership state stay fresh without a full reload.
      refetchOnWindowFocus
      refetchInterval={0}
    >
      <TooltipProvider delayDuration={180} skipDelayDuration={300}>
        {children}
        <Toaster />
      </TooltipProvider>
    </SessionProvider>
  );
}
