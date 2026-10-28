/** True for a loopback Supabase URL (the local Docker stack). */
export function isLocalSupabaseUrl(url: string | undefined): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url ?? "");
}

/**
 * The integration tests create and delete users and rows. Call this before
 * doing anything so they can never run against a hosted project.
 */
export function assertLocalSupabase(): void {
  if (!isLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    throw new Error(
      "Refusing to run: NEXT_PUBLIC_SUPABASE_URL is not a local Supabase stack. Use `npm run test:rls`, which loads .env.supabase-local.",
    );
  }
}
