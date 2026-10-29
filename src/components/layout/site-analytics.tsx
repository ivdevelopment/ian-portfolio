"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

/**
 * Privacy-conscious, cookie-free page analytics and Web Vitals (Vercel).
 * Mounted only in the public site layout, so /admin is never measured, and
 * review invitation links (which carry a secret token in the path) are
 * reported without it.
 */
function stripInvitationToken(event: BeforeSendEvent): BeforeSendEvent {
  try {
    const url = new URL(event.url);
    if (/^\/review\/[^/]+/.test(url.pathname)) {
      url.pathname = "/review/[token]";
      url.search = "";
      return { ...event, url: url.toString() };
    }
  } catch {
    // Unparsable URL: send nothing rather than risk leaking it.
    return { ...event, url: "" };
  }
  return event;
}

export function SiteAnalytics() {
  return (
    <>
      <Analytics beforeSend={stripInvitationToken} />
      <SpeedInsights sampleRate={1} />
    </>
  );
}
