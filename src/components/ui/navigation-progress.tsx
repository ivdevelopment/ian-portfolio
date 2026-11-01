"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Other client code that navigates programmatically (router.push / replace) can call this so the bar shows for it too. */
export const NAVIGATION_START_EVENT = "app:navigation-start";
export function startNavigationProgress() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NAVIGATION_START_EVENT));
}

/** Should a click on this anchor start a page navigation? Pure, so it can be tested. */
export function isNavigationClick(
  link: { href: string; target?: string; hasDownload?: boolean },
  event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  here: { origin: string; pathname: string; search: string },
): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (link.hasDownload || (link.target && link.target !== "_self")) return false;
  let url: URL;
  try {
    url = new URL(link.href, `${here.origin}${here.pathname}${here.search}`);
  } catch {
    return false;
  }
  if (url.origin !== here.origin || !/^https?:$/.test(url.protocol)) return false;
  // Same page (an in-page anchor, or a link to where you already are): nothing to wait for.
  return url.pathname !== here.pathname || url.search !== here.search;
}

/** Longest the bar may stay up if a navigation never lands (e.g. the target redirects back). It is a cap, not a delay. */
const MAX_MS = 15_000;

/**
 * A 2px accent bar at the top of the window. It starts the moment an internal link is clicked and completes when the route
 * (path or search params) has changed. No history patching and no state: it drives one DOM node from a capture-phase click
 * listener and from the router's own pathname/search signals.
 */
function Bar() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const node = useRef<HTMLDivElement>(null);
  const location = useRef(`${pathname}?${search}`);
  const timers = useRef<{ cap?: number; idle?: number }>({});
  const finishRef = useRef<() => void>(() => {});

  useEffect(() => {
    const el = node.current;
    if (!el) return;
    const clear = () => {
      window.clearTimeout(timers.current.cap);
      window.clearTimeout(timers.current.idle);
    };
    const start = () => {
      clear();
      el.dataset.state = "idle";
      void el.offsetWidth; // restart the transition from zero
      el.dataset.state = "loading";
      timers.current.cap = window.setTimeout(finish, MAX_MS);
    };
    function finish() {
      if (el!.dataset.state !== "loading") return;
      clear();
      el!.dataset.state = "done";
      timers.current.idle = window.setTimeout(() => {
        el!.dataset.state = "idle";
      }, 600);
    }

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(target instanceof HTMLAnchorElement) || target.getAttribute("aria-disabled") === "true") return;
      if (isNavigationClick({ href: target.href, target: target.target, hasDownload: target.hasAttribute("download") }, event, { origin: window.location.origin, pathname: window.location.pathname, search: window.location.search })) start();
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener(NAVIGATION_START_EVENT, start);
    // Back/forward restores from the bfcache without a click: make sure a stale bar never stays.
    window.addEventListener("pageshow", finish);
    finishRef.current = finish;
    return () => {
      clear();
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(NAVIGATION_START_EVENT, start);
      window.removeEventListener("pageshow", finish);
    };
  }, []);

  // The route changed: the new page is on screen.
  useEffect(() => {
    const key = `${pathname}?${search}`;
    if (key === location.current) return;
    location.current = key;
    finishRef.current();
  }, [pathname, search]);

  return (
    <div ref={node} data-state="idle" aria-hidden className="nav-progress">
      <span />
    </div>
  );
}

export function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <Bar />
    </Suspense>
  );
}
