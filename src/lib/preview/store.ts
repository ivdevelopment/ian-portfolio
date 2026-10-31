import { z } from "zod";

/** What the gateway may learn about a preview. Never the access-code hash, never the target without a valid session. */
export type GateInfo =
  | { state: "missing" | "inactive" | "expired" }
  | { state: "ok"; id: string; sessionVersion: number; sessionTtlHours: number; expiresAt: string | null };

export type VerifyOutcome =
  | { result: "denied" | "limited" | "unavailable" | "missing" }
  | { result: "ok"; id: string; sessionVersion: number; sessionTtlHours: number; expiresAt: string | null };

/**
 * Where an authorised session is proxied to, and how the origin is told the request comes from the gateway.
 * `secretRef` only NAMES a secret; its value lives in the gateway's environment, never in the database.
 */
export type UpstreamTarget = {
  url: string;
  auth: { type: "none" } | { type: "header"; headerName: string; secretRef: string };
};

/**
 * Every method reads the database on every call. Nothing about a preview's state is cached, so a disable,
 * code reset, target change or expiry applies on the very next request.
 */
export interface PreviewStore {
  gate(subdomain: string): Promise<GateInfo>;
  verify(subdomain: string, code: string, ipHash: string): Promise<VerifyOutcome>;
  upstream(id: string, sessionVersion: number): Promise<UpstreamTarget | null>;
}

const okFields = {
  id: z.uuid(),
  session_version: z.number().int(),
  session_ttl_hours: z.number().int(),
  expires_at: z.string().nullable().optional(),
};
const gateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.enum(["missing", "inactive", "expired"]) }),
  z.object({ state: z.literal("ok"), ...okFields }),
]);
const verifySchema = z.discriminatedUnion("result", [
  z.object({ result: z.enum(["denied", "limited", "unavailable", "missing"]) }),
  z.object({ result: z.literal("ok"), ...okFields }),
]);
const upstreamSchema = z
  .object({
    target_url: z.string(),
    auth_type: z.enum(["none", "header"]),
    header_name: z.string().nullable().optional(),
    secret_ref: z.string().nullable().optional(),
  })
  .nullable();

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Store backed by the three anonymous-callable SECURITY DEFINER functions (no service role anywhere). */
export function createRpcStore(rpc: Rpc): PreviewStore {
  return {
    async gate(subdomain) {
      const { data, error } = await rpc("preview_gate", { p_subdomain: subdomain });
      if (error) throw new Error("preview lookup failed");
      const parsed = gateSchema.parse(data);
      return parsed.state === "ok"
        ? { state: "ok", id: parsed.id, sessionVersion: parsed.session_version, sessionTtlHours: parsed.session_ttl_hours, expiresAt: parsed.expires_at ?? null }
        : { state: parsed.state };
    },
    async verify(subdomain, code, ipHash) {
      const { data, error } = await rpc("verify_preview_access", { p_subdomain: subdomain, p_code: code, p_ip_hash: ipHash });
      if (error) throw new Error("preview verification failed");
      const parsed = verifySchema.parse(data);
      return parsed.result === "ok"
        ? { result: "ok", id: parsed.id, sessionVersion: parsed.session_version, sessionTtlHours: parsed.session_ttl_hours, expiresAt: parsed.expires_at ?? null }
        : { result: parsed.result };
    },
    async upstream(id, sessionVersion) {
      const { data, error } = await rpc("preview_upstream", { p_id: id, p_session_version: sessionVersion });
      if (error) throw new Error("preview target lookup failed");
      const parsed = upstreamSchema.parse(data ?? null);
      if (!parsed) return null;
      if (parsed.auth_type === "header") {
        // A half-configured credential must never degrade into "no credential".
        if (!parsed.header_name || !parsed.secret_ref) throw new Error("preview upstream auth incomplete");
        return { url: parsed.target_url, auth: { type: "header", headerName: parsed.header_name, secretRef: parsed.secret_ref } };
      }
      return { url: parsed.target_url, auth: { type: "none" } };
    },
  };
}
