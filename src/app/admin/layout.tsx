import type { Metadata } from "next";

/**
 * Everything under `/admin` is staff-facing: it must never be indexed and never
 * be cached by a shared proxy. `robots` here covers the whole subtree, including
 * the login screen, so a new page cannot forget it.
 */
export const metadata: Metadata = {
  title: { default: "Admin · back office", template: "%s · Admin" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
