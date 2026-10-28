import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getSupabaseEnv } from "./env";

/**
 * Anonymous, session-less client for public reads. It carries no cookies, so
 * it's safe inside `'use cache'`, and Row Level Security limits it to
 * published content only.
 */
export function createPublicClient() {
  const { url, anonKey } = getSupabaseEnv();

  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
