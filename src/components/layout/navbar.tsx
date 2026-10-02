"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  AnimatePresence,
  motion,
  useScroll,
  useSpring,
  useReducedMotion,
} from "framer-motion";
import {
  ChevronRight,
  Download,
  LayoutDashboard,
  LogOut,
  Menu,
  Radio,
  ShieldCheck,
  Smartphone,
  Terminal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { mainNav, siteConfig } from "@/lib/constants";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/utils";

/* ==========================================================================
   LOGO
   ========================================================================== */

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/"
      className="group flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      aria-label={`${siteConfig.name} — home`}
    >
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
        <span className="absolute inset-0 rotate-45 rounded-[7px] border border-red-500/50 bg-red-500/10 shadow-[0_0_16px_rgba(239,68,68,0.35)] transition-all duration-500 group-hover:rotate-[135deg] group-hover:shadow-[0_0_26px_rgba(239,68,68,0.6)]" />
        <Terminal
          className="relative z-10 h-[18px] w-[18px] text-red-400 transition-colors duration-300 group-hover:text-red-300"
          aria-hidden="true"
        />
      </span>

      {!compact && (
        <span className="flex min-w-0 flex-col leading-none">
          <span className="truncate font-display text-[13px] font-bold uppercase tracking-[0.14em] text-white sm:text-sm">
            Cricket Prediction
          </span>
          <span className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.36em] text-red-500/80">
            Community
          </span>
        </span>
      )}
    </Link>
  );
}

/* ==========================================================================
   NAVBAR
   ========================================================================== */

export function Navbar() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const reduce = useReducedMotion();

  const isLanding = pathname === "/";
  const isAuthed = status === "authenticated" && Boolean(session?.user?.id);
  const loading = status === "loading";

  /* ---- scroll state + progress bar ---- */
  const { scrollYProgress, scrollY } = useScroll();
  const progress = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 26,
    restDelta: 0.001,
  });

  useEffect(() => {
    const unsubscribe = scrollY.on("change", (value) => {
      setScrolled(value > 18);
    });
    return () => unsubscribe();
  }, [scrollY]);

  /* ---- lock body scroll while the mobile drawer is open ---- */
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  /* ---- close the drawer on navigation ---- */
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  /* ---- close on Escape ---- */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleAnchor = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      if (!href.startsWith("#")) return;

      // On inner routes, hand the anchor back to the browser so we navigate
      // to "/#section" instead of trying to scroll a missing element.
      if (!isLanding) return;

      event.preventDefault();
      const target = document.querySelector(href);
      if (!target) return;

      const top =
        target.getBoundingClientRect().top + window.scrollY - (scrolled ? 76 : 88);

      window.scrollTo({
        top,
        behavior: reduce ? "auto" : "smooth",
      });
      setOpen(false);
    },
    [isLanding, reduce, scrolled],
  );

  const handleSignOut = useCallback(async () => {
    setOpen(false);
    // `signOut` performs a full navigation back to the landing page.
    await signOut({ callbackUrl: "/" });
  }, []);

  return (
    <>
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-all duration-500 ease-cyber",
          scrolled
            ? "border-b border-red-500/15 bg-[#09090b]/85 backdrop-blur-xl shadow-[0_8px_32px_-8px_rgba(0,0,0,0.9)]"
            : "border-b border-transparent bg-transparent",
        )}
      >
        {/* Scroll progress rail */}
        <motion.div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-px origin-left bg-gradient-to-r from-red-700 via-red-400 to-red-700"
          style={{ scaleX: progress }}
        />

        <nav
          className="container flex h-16 items-center justify-between gap-4 sm:h-[72px]"
          aria-label="Primary"
        >
          <Logo />

          {/* ---------------- desktop links ---------------- */}
          <ul className="hidden items-center gap-1 lg:flex">
            {mainNav.map((item) => {
              const active = !item.hash && pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={(event) => handleAnchor(event, item.href)}
                    className={cn(
                      "group relative rounded-md px-3.5 py-2",
                      "font-mono text-[11px] font-semibold uppercase tracking-[0.16em]",
                      "transition-colors duration-250",
                      active
                        ? "text-red-400"
                        : "text-zinc-400 hover:text-white",
                    )}
                  >
                    {item.label}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-x-3 -bottom-px h-px origin-left bg-red-500",
                        "transition-transform duration-300 ease-cyber",
                        active
                          ? "scale-x-100 shadow-[0_0_8px_rgba(239,68,68,0.9)]"
                          : "scale-x-0 group-hover:scale-x-100",
                      )}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* ---------------- desktop actions ---------------- */}
          <div className="hidden items-center gap-3 lg:flex">
            {loading ? (
              <div className="h-9 w-32 animate-pulse rounded-md bg-white/[0.04]" />
            ) : isAuthed ? (
              <>
                <Link href="/download">
                  <Button variant="cyber" size="sm">
                    <Smartphone aria-hidden="true" />
                    Download
                  </Button>
                </Link>

                <Link
                  href="/dashboard"
                  className="group flex items-center gap-2.5 rounded-md border border-white/[0.07] bg-white/[0.03] py-1.5 pl-1.5 pr-3 transition-colors hover:border-red-500/45 hover:bg-red-500/[0.06]"
                >
                  <Avatar className="h-7 w-7 rounded">
                    {session?.user?.image ? (
                      <AvatarImage
                        src={session.user.image}
                        alt=""
                        referrerPolicy="no-referrer"
                      />
                    ) : null}
                    <AvatarFallback className="rounded text-[10px]">
                      {initials(session?.user?.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="max-w-[9rem] truncate font-mono text-[11px] uppercase tracking-wider text-zinc-300 group-hover:text-white">
                    {session?.user?.name?.split(" ")[0] ?? "Member"}
                  </span>
                  <ChevronRight
                    className="h-3.5 w-3.5 text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-red-400"
                    aria-hidden="true"
                  />
                </Link>

                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleSignOut}
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut aria-hidden="true" />
                </Button>
              </>
            ) : (
              <>
                <Link href="/login">
                  <Button variant="ghost" size="sm">
                    Sign In
                  </Button>
                </Link>
                <Link href="/register">
                  <Button variant="default" size="sm">
                    <ShieldCheck aria-hidden="true" />
                    Activate Account
                  </Button>
                </Link>
              </>
            )}
          </div>

          {/* ---------------- mobile trigger ---------------- */}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className={cn(
              "relative flex h-10 w-10 items-center justify-center rounded-md lg:hidden",
              "border border-white/10 bg-white/[0.03] text-zinc-300",
              "transition-colors hover:border-red-500/50 hover:text-red-300",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60",
            )}
          >
            <AnimatePresence mode="wait" initial={false}>
              {open ? (
                <motion.span
                  key="close"
                  initial={{ rotate: -90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: 90, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </motion.span>
              ) : (
                <motion.span
                  key="open"
                  initial={{ rotate: 90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: -90, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <Menu className="h-5 w-5" aria-hidden="true" />
                </motion.span>
              )}
            </AnimatePresence>

            {isAuthed && !open && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]" />
            )}
          </button>
        </nav>
      </header>

      {/* ==================== mobile drawer ==================== */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm lg:hidden"
              aria-hidden="true"
            />

            <motion.aside
              key="drawer"
              id="mobile-nav"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "fixed right-0 top-0 z-50 flex h-[100dvh] w-[min(22rem,88vw)] flex-col lg:hidden",
                "border-l border-red-500/20 bg-[#09090b]/97 backdrop-blur-2xl",
                "shadow-[-24px_0_60px_-12px_rgba(0,0,0,0.95)]",
              )}
              role="dialog"
              aria-modal="true"
              aria-label="Mobile navigation"
            >
              <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.06] px-5">
                <Logo />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-zinc-400 transition-colors hover:border-red-500/50 hover:text-red-300"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="no-scrollbar flex-1 overflow-y-auto px-5 py-6">
                {isAuthed && (
                  <Link
                    href="/dashboard"
                    className="mb-6 flex items-center gap-3 rounded-md border border-white/[0.07] bg-white/[0.03] p-3 transition-colors hover:border-red-500/40"
                  >
                    <Avatar className="h-10 w-10">
                      {session?.user?.image ? (
                        <AvatarImage
                          src={session.user.image}
                          alt=""
                          referrerPolicy="no-referrer"
                        />
                      ) : null}
                      <AvatarFallback>
                        {initials(session?.user?.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0">
                      <span className="block truncate font-display text-sm font-semibold text-white">
                        {session?.user?.name}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] uppercase tracking-wider text-red-400/80">
                        {session?.user?.referralCode ?? "Member"}
                      </span>
                    </span>
                  </Link>
                )}

                <ul className="space-y-1">
                  {mainNav.map((item, index) => (
                    <motion.li
                      key={item.href}
                      initial={{ opacity: 0, x: 22 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        delay: 0.05 + index * 0.05,
                        duration: 0.35,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                    >
                      <Link
                        href={item.href}
                        onClick={(event) => handleAnchor(event, item.href)}
                        className="flex items-center justify-between rounded-md px-3 py-3 font-mono text-xs uppercase tracking-[0.16em] text-zinc-300 transition-colors hover:bg-red-500/[0.08] hover:text-white"
                      >
                        <span className="flex items-center gap-3">
                          <span className="text-[10px] text-red-500/60">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          {item.label}
                        </span>
                        <ChevronRight
                          className="h-4 w-4 text-zinc-600"
                          aria-hidden="true"
                        />
                      </Link>
                    </motion.li>
                  ))}
                </ul>

                <div className="divider-glow my-6" />

                <ul className="space-y-1">
                  {isAuthed ? (
                    <>
                      <li>
                        <Link
                          href="/download"
                          className="flex items-center gap-3 rounded-md px-3 py-3 font-mono text-xs uppercase tracking-[0.16em] text-zinc-300 transition-colors hover:bg-red-500/[0.08] hover:text-white"
                        >
                          <Download className="h-4 w-4 text-red-400" aria-hidden="true" />
                          Download Center
                        </Link>
                      </li>
                      <li>
                        <Link
                          href="/dashboard"
                          className="flex items-center gap-3 rounded-md px-3 py-3 font-mono text-xs uppercase tracking-[0.16em] text-zinc-300 transition-colors hover:bg-red-500/[0.08] hover:text-white"
                        >
                          <LayoutDashboard
                            className="h-4 w-4 text-red-400"
                            aria-hidden="true"
                          />
                          Dashboard
                        </Link>
                      </li>
                    </>
                  ) : (
                    <>
                      <li>
                        <Link
                          href="/login"
                          className="flex items-center gap-3 rounded-md px-3 py-3 font-mono text-xs uppercase tracking-[0.16em] text-zinc-300 transition-colors hover:bg-red-500/[0.08] hover:text-white"
                        >
                          <Radio className="h-4 w-4 text-red-400" aria-hidden="true" />
                          Sign In
                        </Link>
                      </li>
                      <li>
                        <Link
                          href="/register"
                          className="flex items-center gap-3 rounded-md px-3 py-3 font-mono text-xs uppercase tracking-[0.16em] text-zinc-300 transition-colors hover:bg-red-500/[0.08] hover:text-white"
                        >
                          <ShieldCheck
                            className="h-4 w-4 text-red-400"
                            aria-hidden="true"
                          />
                          Activate Account
                        </Link>
                      </li>
                    </>
                  )}
                </ul>
              </div>

              <div className="shrink-0 space-y-3 border-t border-white/[0.06] p-5">
                {isAuthed ? (
                  <Button
                    variant="cyber"
                    className="w-full"
                    onClick={handleSignOut}
                  >
                    <LogOut aria-hidden="true" />
                    Sign Out
                  </Button>
                ) : (
                  <>
                    <Link href="/register" className="block">
                      <Button variant="default" className="w-full">
                        <ShieldCheck aria-hidden="true" />
                        Activate Account
                      </Button>
                    </Link>
                    <Link href="/login" className="block">
                      <Button variant="cyber" className="w-full">
                        Sign In
                      </Button>
                    </Link>
                  </>
                )}

                <p className="flex items-center justify-center gap-2 pt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  All systems nominal
                </p>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

export default Navbar;
