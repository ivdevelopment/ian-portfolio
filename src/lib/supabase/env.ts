/** Server-side access to the Supabase configuration, with a clear error when it's missing. */
export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).",
    );
  }

  return { url, anonKey };
}

export const MEDIA_BUCKET = "project-media";
/** Review avatars and site-content images (hero, portrait, CTA). */
export const SITE_BUCKET = "site-media";
