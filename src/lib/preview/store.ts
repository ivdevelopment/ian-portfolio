import { z } from "zod";

/** What the gateway may learn about a preview. Never the access-code hash, never the target without a valid session. */
export type GateInfo =
  | { state: "missing" | "inactive" | "expired" }
  | { state: "ok"; id: string; sessionVersion: number; sessionTtlHours: number; expiresAt: string | null };

export type VerifyOutcome =
  | { result: "denied" | "limited" | "unavailable" | "missing" }
  | { result: "ok"; id: string; sessionVersion: number; sessionTtlHours: number; expiresAt: string | null };

export interface PreviewStore {
  gate(subdomain: string): Promise<GateInfo>;
  verify(subdomain: string, code: string, ipHash: string): Promise<VerifyOutcome>;
  target(id: string, sessionVersion: number): Promise<string | null>;
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
    async target(id, sessionVersion) {
      const { data, error } = await rpc("preview_target", { p_id: id, p_session_version: sessionVersion });
      if (error) throw new Error("preview target lookup failed");
      return typeof data === "string" ? data : null;
    },
  };
}

/**
 * Short in-memory cache of preview state, so one page load with many assets costs one lookup.
 * It bounds how long a disable / expiry / code reset can take to be noticed by this instance
 * (default 5 s, 0 disables the cache). Verification is never cached; a login clears the entry.
 */
export function withStateCache(store: PreviewStore, seconds: number, now: () => number = Date.now): PreviewStore {
  if (seconds <= 0) return store;
  const gates = new Map<string, { at: number; value: GateInfo }>();
  const targets = new Map<string, { at: number; value: string | null }>();
  const fresh = (at: number) => now() - at < seconds * 1000;
  const trim = (m: Map<string, unknown>) => {
    if (m.size > 500) m.clear();
  };

  return {
    async gate(subdomain) {
      const hit = gates.get(subdomain);
      if (hit && fresh(hit.at)) return hit.value;
      const value = await store.gate(subdomain);
      trim(gates);
      gates.set(subdomain, { at: now(), value });
      return value;
    },
    async verify(subdomain, code, ipHash) {
      const result = await store.verify(subdomain, code, ipHash);
      gates.delete(subdomain);
      return result;
    },
    async target(id, version) {
      const key = `${id}:${version}`;
      const hit = targets.get(key);
      if (hit && fresh(hit.at)) return hit.value;
      const value = await store.target(id, version);
      trim(targets);
      targets.set(key, { at: now(), value });
      return value;
    },
  };
}
