import {
  Activity,
  BarChart3,
  Bot,
  BrainCircuit,
  Coins,
  Download,
  Fingerprint,
  Layers,
  LineChart,
  Lock,
  Radar,
  Rocket,
  ShieldCheck,
  Trophy,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

/* ==========================================================================
   SITE
   ========================================================================== */

export const siteConfig = {
  name: "Cricket Prediction Community",
  shortName: "CPC",
  tagline: "Next Generation Cricket Prediction Community",
  description:
    "A private, members-only cricket prediction community. Register your account, join the network and unlock instant access to the Android terminal app.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  locale: "en_IN",
  appVersion: process.env.APK_VERSION ?? "1.0.0",
  apkFileName: process.env.APK_FILE_NAME ?? "app-release.apk",

  /*
   * Contact addresses come from the environment and default to `null` — never
   * to a made-up address. `NEXT_PUBLIC_` is correct here because these values
   * are rendered into public HTML for anyone to read; there is nothing secret
   * about a support inbox. When unset, the UI says so explicitly rather than
   * publishing an address that would bounce.
   */
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null,
  securityEmail:
    process.env.NEXT_PUBLIC_SECURITY_EMAIL?.trim() ||
    process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() ||
    null,
} as const;

/* ==========================================================================
   NAVIGATION
   ========================================================================== */

export type NavItem = {
  label: string;
  href: string;
  /** Render as an in-page anchor + smooth-scroll on the landing page. */
  hash?: boolean;
};

export const mainNav: NavItem[] = [
  { label: "Features", href: "#features", hash: true },
  { label: "About", href: "#about", hash: true },
  { label: "How It Works", href: "#how-it-works", hash: true },
  { label: "FAQ", href: "#faq", hash: true },
  { label: "Download", href: "/download" },
];

export const footerNav = {
  platform: [
    { label: "Features", href: "#features" },
    { label: "How It Works", href: "#how-it-works" },
    { label: "Download Center", href: "/download" },
    { label: "Dashboard", href: "/dashboard" },
  ],
  account: [
    { label: "Activate Account", href: "/register" },
    { label: "Sign In", href: "/login" },
    { label: "Referral Program", href: "#about" },
    { label: "Support", href: "#faq" },
  ],
  legal: [
    { label: "Terms of Service", href: "/terms" },
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Responsible Play", href: "/responsible-play" },
    { label: "Contact", href: "/contact" },
  ],
} as const;

/* ==========================================================================
   FEATURES GRID
   ========================================================================== */

export type Feature = {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Tailwind accent used for the icon glow. */
  accent: "red" | "amber" | "cyan" | "lime";
  tag: string;
};

export const features: Feature[] = [
  {
    icon: BrainCircuit,
    title: "AI Match Intelligence",
    description:
      "Neural models digest pitch reports, player form, weather and eleven years of ball-by-ball history to surface high-confidence fixtures.",
    accent: "red",
    tag: "CORE",
  },
  {
    icon: Users,
    title: "Community Signals",
    description:
      "See how thousands of members are reading every fixture. Crowd consensus, movement alerts and contrarian heat maps in real time.",
    accent: "cyan",
    tag: "SOCIAL",
  },
  {
    icon: LineChart,
    title: "Live Analytics Terminal",
    description:
      "A Bloomberg-style terminal for cricket: strike-rate deltas, economy curves, momentum shifts and win-probability tracking.",
    accent: "lime",
    tag: "DATA",
  },
  {
    icon: ShieldCheck,
    title: "Verified Members Only",
    description:
      "Every account is bound to a verified Google identity. No burner accounts, no spam, no leaking the signal to the outside world.",
    accent: "red",
    tag: "TRUST",
  },
  {
    icon: Coins,
    title: "Referral Rewards",
    description:
      "Every member gets a unique referral code. Invite your circle, climb the ranks and unlock priority features as your network grows.",
    accent: "amber",
    tag: "GROWTH",
  },
  {
    icon: Zap,
    title: "Instant Push Alerts",
    description:
      "Lineup drops, toss results and last-minute weather turns delivered to the Android terminal before the market reacts.",
    accent: "red",
    tag: "SPEED",
  },
];

/* ==========================================================================
   HOW IT WORKS
   ========================================================================== */

export type Step = {
  index: string;
  icon: LucideIcon;
  title: string;
  description: string;
  command: string;
};

export const steps: Step[] = [
  {
    index: "01",
    icon: Fingerprint,
    title: "Activate Your Identity",
    description:
      "Sign in with Google. We generate your unique member ID, a private referral code and lock your profile to your verified email.",
    command: "auth --provider google --scope profile",
  },
  {
    index: "02",
    icon: Layers,
    title: "Sync The Terminal",
    description:
      "Open your dashboard to confirm your registration status and copy your personal referral code for the community tiers.",
    command: "sync --profile --referrals --status",
  },
  {
    index: "03",
    icon: Download,
    title: "Deploy The APK",
    description:
      "Head to the Download Center and pull the signed Android build straight onto your device. Members only — the gate is enforced server-side.",
    command: "install --platform android --build release",
  },
  {
    index: "04",
    icon: Rocket,
    title: "Enter The Network",
    description:
      "Launch the terminal, connect your member ID and start reading the board alongside the rest of the community.",
    command: "connect --node community --live",
  },
];


/* ==========================================================================
   ABOUT / PILLARS
   ========================================================================== */

export const pillars = [
  {
    icon: Bot,
    title: "Automated, not hyped",
    body: "Every signal on the board is produced by a documented model with published hit rates. No tipsters, no screenshots of last night's win.",
  },
  {
    icon: Lock,
    title: "Private by design",
    body: "Your email is never exposed to other members, your referral graph is yours alone, and downloads are logged against your own account only.",
  },
  {
    icon: BarChart3,
    title: "Analytics you can audit",
    body: "Open the terminal and replay how a projection was reached — inputs, weights and confidence intervals, all the way down.",
  },
  {
    icon: Radar,
    title: "Built for the long form",
    body: "Test, T20I and franchise leagues covered with dedicated models rather than one generic engine bolted onto every format.",
  },
  {
    icon: Activity,
    title: "Community calibrated",
    body: "Crowd consensus is treated as a first-class input, then compared against the model to expose genuine edges.",
  },
  {
    icon: Trophy,
    title: "Ranked progression",
    body: "Contribute, refer and stay accurate to climb the member ladder and unlock deeper terminal modules.",
  },
] as const;

/* ==========================================================================
   FAQ
   ========================================================================== */

export type FaqItem = { question: string; answer: string };

export const faqs: FaqItem[] = [
  {
    question: "Why do I need to register before downloading the app?",
    answer:
      "The Android terminal talks to member-only endpoints. Your account binds the device to a verified Google identity, provisions your referral code and keeps the network free of throwaway accounts. Registration takes about ten seconds and the download unlocks immediately.",
  },
  {
    question: "How does the referral code work?",
    answer:
      "A unique code is generated the moment your account is created and is shown on your dashboard. Share it with your circle — anyone who registers with it is linked to you, which feeds your community standing and unlocks higher membership tiers as your network grows.",
  },
  {
    question: "Is the Android APK free?",
    answer:
      "Yes. The release build is distributed at no cost to registered members from the Download Center. You only need an activated account — there is no paywall on the download itself.",
  },
  {
    question: "Will I need to allow installation from unknown sources?",
    answer:
      "Because the build is distributed directly rather than through the Play Store, Android will ask you to allow installs from your browser or file manager once. The setting lives under Settings → Apps → Special access → Install unknown apps.",
  },
  {
    question: "What data do you store about me?",
    answer:
      "Only what the platform needs: your name, email, Google account identifier, profile picture, your generated referral code and timestamps. Downloads are recorded against your own account so you can review them. No passwords are ever stored — authentication is delegated entirely to Google.",
  },
  {
    question: "Can I delete my account?",
    answer:
      "Yes. Reach out through the contact link in the footer and the account, referral link and associated download history are removed from PostgreSQL. This is a hard delete, not a soft flag.",
  },
  {
    question: "Which devices are supported?",
    answer:
      "Any Android device running 8.0 (Oreo, API 26) or above with an active internet connection. The terminal is built for phone form factors first and scales up to tablets.",
  },
  {
    question: "Does the platform guarantee predictions?",
    answer:
      "No. Every projection is a probabilistic estimate published for research and entertainment. The community is a discussion platform, not financial advice, and no outcome is ever guaranteed.",
  },
];

/* ==========================================================================
   DOWNLOAD / APP METADATA
   ========================================================================== */

/**
 * Static description of the release. Every value that describes a *specific
 * binary* — package name, build number, size, checksum, release date, min SDK,
 * ABI — now comes from `resolveArtifact()` (measured from the file on disk plus
 * `storage/apk/release.json`). Nothing here is invented, and nothing here can
 * drift out of sync with the bytes actually served.
 */
export const appRelease = {
  name: "Android Terminal APK",
  fileName: siteConfig.apkFileName,
  features: [
    "Full live analytics terminal",
    "AI match intelligence feed",
    "Community consensus board",
    "Instant lineup & toss push alerts",
    "Referral rank tracker",
  ],
} as const;

/* ==========================================================================
   MEMBERSHIP TIERS (dashboard progress)
   ========================================================================== */

export const membershipTiers = [
  { name: "Recruit", minReferrals: 0, perk: "Terminal access" },
  { name: "Analyst", minReferrals: 3, perk: "Deep-history models" },
  { name: "Strategist", minReferrals: 10, perk: "API + export tools" },
  { name: "Architect", minReferrals: 25, perk: "Private signal rooms" },
] as const;

export function tierForReferrals(count: number) {
  let current: (typeof membershipTiers)[number] = membershipTiers[0];
  for (const tier of membershipTiers) {
    if (count >= tier.minReferrals) current = tier;
  }
  const next =
    membershipTiers.find((tier) => tier.minReferrals > count) ?? null;
  return {
    current,
    next,
    progress: next
      ? Math.min(
          100,
          Math.round(
            ((count - current.minReferrals) /
              (next.minReferrals - current.minReferrals)) *
              100,
          ),
        )
      : 100,
  };
}

/* ==========================================================================
   MISC
   ========================================================================== */

export const NEWSLETTER_NOTE =
  "Member-only. No spam, no third-party sharing, unsubscribe in one click.";
