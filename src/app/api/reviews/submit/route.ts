import { NextResponse } from "next/server";
import { clientIp, readJsonBody } from "@/lib/api-json";
import { processReviewSubmission } from "@/lib/review-submit";
import { isSameOriginRequest } from "@/lib/same-origin";
import type { ReviewSubmitResult } from "@/lib/schemas/review";

/**
 * Public review submission via an invitation link. A plain, stable URL on
 * purpose: unlike a Server Action it has no deployment-specific ID, so a
 * cached page or an open tab from an older deployment keeps working.
 *
 * The invitation token travels in the JSON body (never the URL), is hashed by
 * the shared logic, and is never logged or echoed back.
 */
const json = (body: ReviewSubmitResult, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!isSameOriginRequest(request.headers.get("origin"), request.headers.get("host"))) {
    return json({ status: "error", message: "That request couldn't be verified. Please refresh and try again." }, 403);
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return json({ status: "error", message: "That request couldn't be read. Please try again." }, 400);
  }

  const { token, values, elapsedMs } = body.payload;
  return json(await processReviewSubmission(token, values, elapsedMs, clientIp(request.headers)));
}
