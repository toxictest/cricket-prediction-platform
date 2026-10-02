import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Orbitron } from "next/font/google";
import { Providers } from "@/components/providers";
import { CyberBackground } from "@/components/effects/cyber-background";
import { siteConfig } from "@/lib/constants";
import { cn } from "@/lib/utils";
import "./globals.css";

/* ==========================================================================
   FONTS
   All three are self-hosted by next/font at build time: zero layout shift,
   no third-party request at runtime, and no FOUT.
   ========================================================================== */

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

const orbitron = Orbitron({
  subsets: ["latin"],
  display: "swap",
  weight: ["500", "600", "700", "800", "900"],
  variable: "--font-display",
});

/* ==========================================================================
   METADATA
   ========================================================================== */

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${siteConfig.name} — Android Terminal Access`,
    template: `%s · ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  authors: [{ name: siteConfig.name }],
  generator: "Next.js",
  keywords: [
    "cricket prediction",
    "cricket analytics",
    "prediction community",
    "cricket terminal",
    "android apk",
    "sports modelling",
    "referral program",
  ],
  category: "sports",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: siteConfig.locale,
    url: siteConfig.url,
    siteName: siteConfig.name,
    title: `${siteConfig.name} — Register and unlock application access`,
    description: siteConfig.description,
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.name,
    description: siteConfig.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
    { media: "(prefers-color-scheme: light)", color: "#09090b" },
  ],
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

/* ==========================================================================
   ROOT LAYOUT
   ========================================================================== */

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className="dark"
      suppressHydrationWarning
      style={{ colorScheme: "dark" }}
    >
      <body
        className={cn(
          inter.variable,
          jetbrainsMono.variable,
          orbitron.variable,
          "min-h-[100dvh] bg-[#09090b] font-sans text-zinc-200 antialiased",
        )}
      >
        {/* Skip link for keyboard + screen-reader users */}
        <a
          href="#main"
          className={cn(
            "sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100]",
            "focus:rounded-md focus:border focus:border-red-500/60 focus:bg-zinc-950",
            "focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:uppercase",
            "focus:tracking-wider focus:text-red-300 focus:shadow-neon",
          )}
        >
          Skip to content
        </a>

        {/* Layered cyberpunk backdrop: grid → orbs → fire → grain → vignette */}
        <CyberBackground density={190} />

        <Providers>
          <div className="relative flex min-h-[100dvh] flex-col">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
