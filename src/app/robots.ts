import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/utils";

/**
 * Crawler policy.
 *
 * The marketing pages are indexable. Everything behind the membership gate is
 * explicitly disallowed so gated URLs never leak into search results, and the
 * download endpoint is blocked outright to keep crawlers from hammering it.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/login", "/register", "/terms", "/privacy", "/responsible-play", "/contact"],
        disallow: [
          "/dashboard",
          "/download",
          "/downloads/",
          "/api/",
          "/account",
          "/settings",
          "/referrals",
        ],
      },
      {
        // Some scrapers ignore robots.txt; this at least documents intent.
        userAgent: "GPTBot",
        disallow: ["/"],
      },
      {
        userAgent: "CCBot",
        disallow: ["/"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/"),
  };
}
