import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

/** Browser client (admin media uploads). Uses the signed-in admin's session; RLS applies. */
export function createBrowserSupabase() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
