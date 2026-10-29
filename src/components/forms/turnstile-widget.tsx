"use client";

import { useEffect, useRef } from "react";

type TurnstileApi = {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string;
      appearance: "interaction-only";
      theme: "dark";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export const turnstileEnabled = Boolean(SITE_KEY);

export type TurnstileHandle = { reset: () => void };

/**
 * Invisible unless Cloudflare decides the visitor needs to interact
 * (`interaction-only`). Renders nothing at all when no site key is configured.
 */
export function TurnstileWidget({
  onToken,
  handleRef,
}: {
  onToken: (token: string | null) => void;
  handleRef: React.RefObject<TurnstileHandle | null>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  });

  useEffect(() => {
    if (!SITE_KEY || !container.current) return;
    const el = container.current;
    let cancelled = false;

    const mount = () => {
      if (cancelled || !window.turnstile || widgetId.current) return;
      widgetId.current = window.turnstile.render(el, {
        sitekey: SITE_KEY,
        appearance: "interaction-only",
        theme: "dark",
        callback: (token) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(null),
        "error-callback": () => onTokenRef.current(null),
      });
    };

    handleRef.current = {
      reset: () => {
        onTokenRef.current(null);
        if (widgetId.current) window.turnstile?.reset(widgetId.current);
      },
    };

    if (window.turnstile) {
      mount();
    } else {
      let script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
      if (!script) {
        script = document.createElement("script");
        script.src = SCRIPT_SRC;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", mount);
    }

    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = undefined;
      handleRef.current = null;
    };
  }, [handleRef]);

  if (!SITE_KEY) return null;
  return <div ref={container} className="mt-4" />;
}
