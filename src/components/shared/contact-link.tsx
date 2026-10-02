import { Mail, TriangleAlert } from "lucide-react";
import { siteConfig } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * Renders a real contact address, or an explicit "not configured" state.
 *
 * The previous build hard-coded `support@example.com` in six places. That is
 * worse than having no address at all: `example.com` is a reserved domain, so
 * every message sent to it is silently discarded while the page still looks
 * like a working support channel.
 *
 * Set `NEXT_PUBLIC_CONTACT_EMAIL` (and optionally `NEXT_PUBLIC_SECURITY_EMAIL`)
 * to publish a real inbox. Until then the UI says it is unconfigured — loudly
 * enough that it cannot ship unnoticed, quietly enough not to crash a page.
 */
export function ContactLink({
  kind = "contact",
  subject,
  className,
  /** Show the unconfigured warning. Disabled in dense inline prose. */
  warn = true,
}: {
  kind?: "contact" | "security";
  subject?: string;
  className?: string;
  warn?: boolean;
}) {
  const address =
    kind === "security" ? siteConfig.securityEmail : siteConfig.contactEmail;

  if (!address) {
    if (!warn) {
      return <span className={className}>the address published on our contact page</span>;
    }
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded border border-amber-500/30 bg-amber-500/[0.06] px-2 py-0.5 font-mono text-[11px] text-amber-300",
          className,
        )}
        title="Set NEXT_PUBLIC_CONTACT_EMAIL to publish a real address"
      >
        <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
        email not configured
      </span>
    );
  }

  const href = subject
    ? `mailto:${address}?subject=${encodeURIComponent(subject)}`
    : `mailto:${address}`;

  return (
    <a
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 font-medium text-red-400 underline-offset-4 transition-colors hover:text-red-300 hover:underline",
        className,
      )}
    >
      <Mail className="h-3.5 w-3.5" aria-hidden="true" />
      {address}
    </a>
  );
}

export default ContactLink;
