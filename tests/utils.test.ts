import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  clamp,
  cn,
  formatDate,
  formatDateTime,
  initials,
  maskEmail,
  timeAgo,
  uid,
} from "@/lib/utils";

describe("cn", () => {
  it("merges conditionals", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });

  it("resolves conflicting Tailwind classes last-wins", () => {
    // This is the whole reason tailwind-merge is in the dependency tree.
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
  });

  it("keeps non-conflicting classes from both sides", () => {
    expect(cn("flex items-center", "gap-3")).toBe("flex items-center gap-3");
  });
});

describe("formatDate", () => {
  it("renders the project's canonical display format", () => {
    expect(formatDate(new Date("2026-10-02T12:00:00Z"))).toMatch(
      /^0?2 Oct 2026$/,
    );
  });

  it("accepts ISO strings as well as Date objects", () => {
    expect(formatDate("2026-09-18")).toBe(formatDate(new Date("2026-09-18")));
  });

  it("returns an em dash for null, undefined and invalid input", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("includes a 24-hour clock component", () => {
    const out = formatDateTime(new Date("2026-10-02T14:35:00Z"));
    expect(out).toMatch(/Oct 2026/);
    expect(out).toMatch(/\d{2}:\d{2}/);
  });
});

describe("timeAgo", () => {
  it("collapses the first 45 seconds to 'just now'", () => {
    expect(timeAgo(new Date())).toBe("just now");
    expect(timeAgo(new Date(Date.now() - 30_000))).toBe("just now");
  });

  it("uses relative units", () => {
    expect(timeAgo(new Date(Date.now() - 5 * 60_000))).toMatch(/5 minutes ago/);
    expect(timeAgo(new Date(Date.now() - 3 * 3_600_000))).toMatch(/3 hours ago/);
    expect(timeAgo(new Date(Date.now() - 2 * 86_400_000))).toMatch(
      /2 days ago|yesterday/,
    );
  });

  it("degrades gracefully", () => {
    expect(timeAgo(null)).toBe("—");
  });
});

describe("maskEmail", () => {
  it("reveals at most two leading characters", () => {
    expect(maskEmail("jordan@gmail.com")).toBe("jo****@gmail.com");
  });

  it("handles very short local parts", () => {
    expect(maskEmail("a@x.com")).toBe("a**@x.com");
  });

  it("passes malformed input through rather than throwing", () => {
    expect(maskEmail("not-an-email")).toBe("not-an-email");
  });

  it("never leaks the full local part into the masked form", () => {
    const masked = maskEmail("supersecret@example.com");
    expect(masked).not.toContain("supersecret");
    expect(masked.endsWith("@example.com")).toBe(true);
  });
});

describe("absoluteUrl", () => {
  it("joins the base and path without doubling slashes", () => {
    const out = absoluteUrl("/register?ref=CRC-ARCH1TEC");
    expect(out).toMatch(/\/register\?ref=CRC-ARCH1TEC$/);
    expect(out).not.toMatch(/[^:]\/\//);
  });

  it("adds a leading slash when one is missing", () => {
    expect(absoluteUrl("dashboard")).toMatch(/\/dashboard$/);
  });

  it("returns just the base when called with no argument", () => {
    expect(absoluteUrl()).not.toMatch(/\/$/);
  });
});

describe("initials", () => {
  it("takes at most two initials", () => {
    expect(initials("Aarav Mehta")).toBe("AM");
    expect(initials("Priya Devi Nair")).toBe("PD");
  });

  it("handles single names and extra whitespace", () => {
    expect(initials("  Aarav  ")).toBe("A");
    expect(initials("Aarav")).toBe("A");
  });

  it("falls back to ?? for empty input", () => {
    expect(initials(null)).toBe("??");
    expect(initials(undefined)).toBe("??");
    expect(initials("")).toBe("??");
  });
});

describe("clamp", () => {
  it("bounds the value on both sides", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it("is inclusive of the bounds", () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe("uid", () => {
  it("prefixes and stays unique", () => {
    const ids = new Set(Array.from({ length: 500 }, () => uid("test")));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id.startsWith("test-")).toBe(true);
  });
});
