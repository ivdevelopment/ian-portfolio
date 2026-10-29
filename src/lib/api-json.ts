/** Largest JSON body a public form endpoint will read. */
export const MAX_JSON_BODY_BYTES = 16 * 1024;

export type JsonBody = { ok: true; payload: Record<string, unknown> } | { ok: false };

/** Reads a small JSON object body; anything empty, oversized, malformed or non-object is rejected. */
export async function readJsonBody(request: Request): Promise<JsonBody> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) return { ok: false };

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_JSON_BODY_BYTES) return { ok: false };

  const raw = await request.text().catch(() => "");
  if (raw.length === 0 || new TextEncoder().encode(raw).length > MAX_JSON_BODY_BYTES) return { ok: false };

  try {
    const payload: unknown = JSON.parse(raw);
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return { ok: true, payload: payload as Record<string, unknown> };
    }
  } catch {
    // fall through
  }
  return { ok: false };
}

/** Client IP as the platform reports it; only ever hashed, never stored raw. */
export function clientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headers.get("x-real-ip") ?? "unknown"
  );
}
