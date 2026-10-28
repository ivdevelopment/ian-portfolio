"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X } from "lucide-react";
import { siteConfig } from "@/config/site";
import { ButtonLink } from "@/components/ui/button";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Full-screen mobile navigation. Rendered in a portal so the header's backdrop-filter can't clip it. */
const subscribeNoop = () => () => {};

export function MobileMenu() {
  const [open, setOpen] = useState(false);
  // False during SSR and hydration, true afterwards: portals need `document`.
  const canPortal = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const items = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="glass inline-flex size-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-glass-strong md:hidden"
      >
        <Menu aria-hidden className="size-5" />
      </button>

      {canPortal &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label="Menu"
                className="fixed inset-0 z-[60] flex flex-col bg-bg/95 px-(--gutter) backdrop-blur-2xl md:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <div className="flex h-(--nav-h) items-center justify-between">
                  <span className="text-xl font-medium tracking-tight">
                    {siteConfig.initials}
                  </span>
                  <button
                    type="button"
                    aria-label="Close menu"
                    onClick={close}
                    className="glass inline-flex size-11 items-center justify-center rounded-full text-ink"
                  >
                    <X aria-hidden className="size-5" />
                  </button>
                </div>

                <nav aria-label="Primary" className="mt-8 flex-1">
                  <ul className="divide-y divide-line border-y border-line">
                    {siteConfig.nav.map((item, i) => (
                      <motion.li
                        key={item.href}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          delay: 0.05 + i * 0.05,
                          duration: 0.45,
                          ease: [0.22, 1, 0.36, 1],
                        }}
                      >
                        <Link
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className="flex items-center justify-between py-5 text-3xl font-medium tracking-tight text-ink"
                        >
                          {item.label}
                          <span aria-hidden className="text-sm text-subtle">
                            0{i + 1}
                          </span>
                        </Link>
                      </motion.li>
                    ))}
                  </ul>
                </nav>

                <div className="pb-8">
                  <ButtonLink
                    href={siteConfig.cta.href}
                    variant="primary"
                    size="lg"
                    className="w-full"
                    onClick={() => setOpen(false)}
                  >
                    {siteConfig.cta.label}
                  </ButtonLink>
                  <p className="mt-4 text-center text-sm text-muted">
                    {siteConfig.email}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
