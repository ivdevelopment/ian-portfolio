/**
 * Admin access gate — placeholder.
 *
 * TODO(P1): replace with Supabase Auth. `requireAdmin()` should read the
 * session, redirect to a sign-in page when absent, and return the user.
 * Until then /admin is an unauthenticated, empty shell (no data, no actions)
 * and is excluded from indexing and the sitemap.
 */
export async function requireAdmin(): Promise<{ authenticated: false }> {
  return { authenticated: false };
}
