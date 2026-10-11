/* ==========================================================================
   OUTBOUND URLS
   ==========================================================================

   Two places in this app store a URL that someone else's browser will open:
   the payment proof a member uploads, and the QR image an admin attaches to a
   match. Both are stored verbatim and rendered later — a proof link in the
   admin queue, a QR on every member's deposit screen — so both need the same
   question answered: *will this link hurt the person who clicks it?*

   A `javascript:` value executes in the reviewer's browser. A `data:` value
   smuggles a megabyte of base64 past a length check. A link to `127.0.0.1`,
   `169.254.169.254` (cloud metadata) or an internal admin tool turns a public
   page into a proxy for the network behind your load balancer, and leaks the
   shape of that network to anyone who can read the row.

   This module is the pure check. Each service wraps it in its own error type,
   because the field names a client has to see differ.
   ========================================================================== */

export const MAX_EXTERNAL_URL_LENGTH = 2048;

export type ExternalUrlProblem =
  | "EMPTY"
  | "TOO_LONG"
  | "NOT_ABSOLUTE"
  | "NOT_HTTP"
  | "HAS_CREDENTIALS"
  | "INTERNAL_HOST";

export type ExternalUrlResult =
  | { ok: true; href: string }
  | { ok: false; problem: ExternalUrlProblem };

/**
 * Parses `value` and reports the first thing wrong with it. On success `href`
 * is the URL's canonical form, which is what gets stored: `http://x.test/a` and
 * ` http://x.test/a ` become one string, so a value that is read back and
 * compared later still matches.
 */
export function inspectExternalUrl(
  value: unknown,
  maxLength: number = MAX_EXTERNAL_URL_LENGTH,
): ExternalUrlResult {
  if (typeof value !== "string") return { ok: false, problem: "EMPTY" };

  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, problem: "EMPTY" };
  if (trimmed.length > maxLength) return { ok: false, problem: "TOO_LONG" };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, problem: "NOT_ABSOLUTE" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, problem: "NOT_HTTP" };
  }
  if (url.username || url.password) return { ok: false, problem: "HAS_CREDENTIALS" };
  if (isBlockedHost(url.hostname)) return { ok: false, problem: "INTERNAL_HOST" };

  return { ok: true, href: url.toString() };
}

/**
 * Message for a rejected URL. `internalHostMessage` lets a service name the
 * thing it expects on the other end ("your storage host"), because a generic
 * "internal address" reply teaches a member nothing about what to upload.
 */
export function externalUrlMessage(
  field: string,
  problem: ExternalUrlProblem,
  maxLength: number,
  internalHostMessage?: string,
): string {
  switch (problem) {
    case "EMPTY":
      return `${field} must be a non-empty string`;
    case "TOO_LONG":
      return `${field} must be 1 to ${maxLength} characters`;
    case "NOT_ABSOLUTE":
      return `${field} must be an absolute URL`;
    case "NOT_HTTP":
      return `${field} must be an http or https URL`;
    case "HAS_CREDENTIALS":
      return `${field} must not carry credentials`;
    case "INTERNAL_HOST":
      return internalHostMessage ?? `${field} must not point at an internal or link-local address`;
  }
}

/** Loopback, private, link-local, carrier-NAT and cloud-metadata ranges. */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "metadata.google.internal" ||
    host === "ec2instance-metadata" ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1"
  ) {
    return true;
  }

  const octets = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (octets) {
    if (octets.some((part, index) => index > 0 && Number(part) > 255)) return true;
    const [a, b] = [Number(octets[1]), Number(octets[2])];
    // 127/8 loopback, 10/8 and 172.16/12 private, 192.168/16 private,
    // 169.254/16 link-local (cloud metadata), 100.64/10 service-provider NAT.
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }

  // IPv6 loopback and unique-local ranges, after the bracket strip above.
  if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;

  return false;
}
