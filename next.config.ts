import type { NextConfig } from "next";

/**
 * Security headers applied to every response.
 * The CSP intentionally allows inline styles (Tailwind runtime + shadcn) and
 * Google's avatar CDN, while blocking object embedding and framing.
 */
const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,

  // Prisma must stay external to the server bundle so its query engine
  // binary is resolved from node_modules at runtime.
  serverExternalPackages: ["@prisma/client", "prisma"],

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        pathname: "/**",
      },
    ],
    formats: ["image/avif", "image/webp"],
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // The APK must never be cached by an intermediary proxy.
        source: "/downloads/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
          {
            key: "Content-Type",
            value: "application/vnd.android.package-archive",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
