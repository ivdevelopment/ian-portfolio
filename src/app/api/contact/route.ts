import { NextResponse } from "next/server";
import { processInquiry } from "@/lib/inquiry-submit";
import { isSameOriginRequest } from "@/lib/same-origin";
import type { InquiryResult } from "@/lib/schemas/inquiry";

/**
 * Public contact submission. A plain, stable URL on purpose: unlike a Server
 * Action it has no deployment-specific ID, so a cached page or an open tab from
 * an older deployment keeps working after a redeploy.
 */
const MAX_BODY_BYTES = 16 * 1024;

const json = (body: InquiryResult, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!isSameOriginRequest(request.headers.get("origin"), request.headers.get("host"))) {
    return json({ status: "error", message: "That request couldn't be verified. Please refresh and try again." }, 403);
  }

  const raw = await request.text().catch(() => "");
  if (raw.length === 0 || raw.length > MAX_BODY_BYTES) {
    return json({ status: "error", message: "That request couldn't be read. Please try again." }, 400);
  }

  let payload: { values?: unknown; elapsedMs?: unknown; turnstileToken?: unknown };
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ status: "error", message: "That request couldn't be read. Please try again." }, 400);
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  return json(await processInquiry(payload.values, payload.elapsedMs, payload.turnstileToken, ip));
}
