import "server-only";

import { requireAdmin } from "@/lib/auth";

/** Every column EXCEPT the access-code hash (which no API role may read). */
export const PREVIEW_COLUMNS =
  "id, client_name, project_name, subdomain, target_url, active, expires_at, session_ttl_hours, session_version, first_accessed_at, last_accessed_at, successful_access_count, notes, created_at, updated_at";

export type PreviewRow = {
  id: string;
  client_name: string;
  project_name: string;
  subdomain: string;
  target_url: string;
  active: boolean;
  expires_at: string | null;
  session_ttl_hours: number;
  session_version: number;
  first_accessed_at: string | null;
  last_accessed_at: string | null;
  successful_access_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export async function listPreviews(): Promise<PreviewRow[]> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("client_previews")
    .select(PREVIEW_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[admin] failed to list previews:", error.message);
    throw new Error("Client previews unavailable");
  }
  return data as PreviewRow[];
}

export async function loadPreview(id: string): Promise<PreviewRow | null> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("client_previews").select(PREVIEW_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    console.error("[admin] failed to load preview:", error.message);
    throw new Error("Client preview unavailable");
  }
  return data as PreviewRow | null;
}
