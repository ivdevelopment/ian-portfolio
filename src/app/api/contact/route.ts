import { NextResponse } from "next/server";
import { clientIp, readJsonBody } from "@/lib/api-json";
import { defaultLocale, isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { processInquiry } from "@/lib/inquiry-submit";
import { isSameOriginRequest } from "@/lib/same-origin";
import type { InquiryResult } from "@/lib/schemas/inquiry";

/**
 * Public contact submission. A plain, stable URL on purpose: unlike a Server
 * Action it has no deployment-specific ID, so a cached page or an open tab from
 * an older deployment keeps working after a redeploy. Not localized (/api/*):
 * the visitor's language travels in the body and only picks the message language.
 */
const json = (body: InquiryResult, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  // Errors before the body is understood use the default language.
  const early = getDictionary(defaultLocale).contact.server;
  if (!isSameOriginRequest(request.headers.get("origin"), request.headers.get("host"))) {
    return json({ status: "error", message: early.unverified }, 403);
  }

  const body = await readJsonBody(request);
  if (!body.ok) return json({ status: "error", message: early.unreadable }, 400);

  const { values, elapsedMs, turnstileToken, locale } = body.payload;
  return json(
    await processInquiry(
      values,
      elapsedMs,
      turnstileToken,
      clientIp(request.headers),
      isLocale(locale) ? locale : defaultLocale,
    ),
  );
}
