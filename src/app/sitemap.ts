import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/utils";

/**
 * Only publicly reachable, indexable routes are listed.
 * Gated routes (/dashboard, /download) are deliberately omitted — they require
 * a session, so including them would only produce soft-404s in Search Console.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-09-18T00:00:00.000Z");

  return [
    {
      url: absoluteUrl("/"),
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: absoluteUrl("/register"),
      lastModified,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: absoluteUrl("/login"),
      lastModified,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: absoluteUrl("/terms"),
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: absoluteUrl("/privacy"),
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: absoluteUrl("/responsible-play"),
      lastModified,
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: absoluteUrl("/contact"),
      lastModified,
      changeFrequency: "yearly",
      priority: 0.4,
    },
  ];
}
