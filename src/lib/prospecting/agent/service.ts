import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { BusinessDataSummary } from "./business-data";
import { generateAgentToken, hashAgentToken, tokenHint } from "./tokens";

/**
 * The CRM side of device management, run with the signed-in admin's session (RLS: admins only; the token hash cannot even be read back).
 * There is one device at a time: this is a personal CRM, and creating a new token is also how a token is rotated.
 */
type Db = SupabaseClient<Database>;

/** The agent heartbeats about every 20 seconds; after this long without one it is shown as offline. */
export const ONLINE_WITHIN_MS = 90_000;
export const DEFAULT_DEVICE_NAME = "Ian-PC";

export type AgentStatus = {
  id: string;
  name: string;
  hint: string;
  createdAt: string;
  lastSeenAt: string | null;
  online: boolean;
  codexVersion: string | null;
  codexState: "ready" | "not_installed" | "not_authenticated" | "error" | null;
  lastFailureKind: string | null;
  /** The agent's local business data (OpenStreetMap index), as last reported. */
  businessData: BusinessDataSummary | null;
};

export function isOnline(lastSeenAt: string | null, now = Date.now()): boolean {
  return lastSeenAt !== null && now - Date.parse(lastSeenAt) < ONLINE_WITHIN_MS;
}

export async function getAgentStatus(db: Db, now = Date.now()): Promise<AgentStatus | null> {
  const { data } = await db
    .from("prospect_agents")
    .select("id, display_name, token_hint, created_at, last_seen_at, codex_version, codex_state, last_failure_kind, business_data")
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    name: data.display_name,
    hint: data.token_hint,
    createdAt: data.created_at,
    lastSeenAt: data.last_seen_at,
    online: isOnline(data.last_seen_at, now),
    codexVersion: data.codex_version,
    codexState: data.codex_state as AgentStatus["codexState"],
    lastFailureKind: data.last_failure_kind,
    businessData: data.business_data && typeof data.business_data === "object" && !Array.isArray(data.business_data) ? (data.business_data as unknown as BusinessDataSummary) : null,
  };
}

/** Creates a device and returns its token ONCE. Any earlier device is revoked first, which is what rotation means here. */
export async function createAgentToken(db: Db, userId: string, displayName: string): Promise<{ ok: true; token: string; name: string } | { ok: false; error: string }> {
  const name = displayName.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!name) return { ok: false, error: "Enter a name for this device, for example Ian-PC." };
  const revoked = await db.from("prospect_agents").update({ revoked_at: new Date().toISOString() }).is("revoked_at", null);
  if (revoked.error) return { ok: false, error: "That couldn't be saved. Please try again." };
  const token = generateAgentToken();
  const { error } = await db.from("prospect_agents").insert({ display_name: name, token_hash: hashAgentToken(token), token_hint: tokenHint(token), created_by: userId });
  if (error) return { ok: false, error: "That couldn't be saved. Please try again." };
  return { ok: true, token, name };
}

/** Takes effect at once: every agent function re-checks the token against this row. */
export async function revokeAgent(db: Db): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await db.from("prospect_agents").update({ revoked_at: new Date().toISOString() }).is("revoked_at", null);
  return error ? { ok: false, error: "That couldn't be saved. Please try again." } : { ok: true };
}
