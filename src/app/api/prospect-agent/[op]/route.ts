import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { AGENT_OPS, MAX_BODY_BYTES, handleAgentOp, rateLimited, type AgentOp } from "@/lib/prospecting/agent/endpoint";
import { bearerToken } from "@/lib/prospecting/agent/tokens";

/**
 * The Local Prospect Agent's API. Only POST, only with `Authorization: Bearer <connection token>`; no cookie, no admin session and no
 * service-role key is involved (the database functions check the token). This route exists on the main application only: the dedicated
 * preview-gateway deployment answers 404 for every /api path, and the CRM host serves no /api at all.
 */
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request, ctx: { params: Promise<{ op: string }> }) {
  const { op } = await ctx.params;
  if (!(AGENT_OPS as readonly string[]).includes(op)) return json(404, { ok: false, error: "not_found" });
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return json(401, { ok: false, error: "unauthorized" });
  if (rateLimited(token)) return json(429, { ok: false, error: "rate_limited" });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return json(413, { ok: false, error: "too_large" });
  const body = await request.text();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return json(503, { ok: false, error: "unavailable" });
  const db = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });

  const result = await handleAgentOp(op as AgentOp, token, body, async (fn, args) => {
    const { data, error } = await db.rpc(fn as never, args as never);
    return { data, error: error ? { message: error.message } : null };
  });
  return json(result.status, result.body);
}

export const GET = () => json(405, { ok: false, error: "method_not_allowed" });
