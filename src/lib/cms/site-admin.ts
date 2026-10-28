import "server-only";

import type { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import {
  defaultAboutContent,
  defaultContactContent,
  defaultHomeContent,
  defaultSiteSettings,
} from "@/data/default-content";
import {
  aboutContentSchema,
  contactContentSchema,
  homeContentSchema,
  siteSettingsSchema,
  type AboutContent,
  type ContactContent,
  type HomeContent,
  type SiteSettings,
} from "@/lib/schemas/site-content";

/**
 * Admin-side reads of site content (uncached, any state). Invalid stored JSON
 * falls back to the defaults so the editor always opens and can repair it.
 */
async function load<S extends z.ZodType>(
  key: "home" | "about" | "contact",
  schema: S,
  fallback: z.infer<S>,
): Promise<z.infer<S>> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("site_content").select("content").eq("key", key).maybeSingle();
  if (error) {
    console.error(`[admin] failed to load "${key}":`, error.message);
    throw new Error("Content unavailable");
  }
  const parsed = schema.safeParse(data?.content);
  return parsed.success ? parsed.data : fallback;
}

export const loadHomeContent = (): Promise<HomeContent> => load("home", homeContentSchema, defaultHomeContent);
export const loadAboutContent = (): Promise<AboutContent> => load("about", aboutContentSchema, defaultAboutContent);
export const loadContactContent = (): Promise<ContactContent> =>
  load("contact", contactContentSchema, defaultContactContent);

export async function loadSettings(): Promise<SiteSettings> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("site_settings").select("*").maybeSingle();
  if (error) {
    console.error("[admin] failed to load settings:", error.message);
    throw new Error("Settings unavailable");
  }
  if (!data) return defaultSiteSettings;
  const parsed = siteSettingsSchema.safeParse({
    siteName: data.site_name,
    displayName: data.display_name,
    location: data.location ?? "",
    contactEmail: data.contact_email ?? "",
    githubUrl: data.github_url ?? "",
    linkedinUrl: data.linkedin_url ?? "",
    instagramUrl: data.instagram_url ?? "",
    xUrl: data.x_url ?? "",
    seoDefaultTitle: data.seo_default_title,
    seoTitleTemplate: data.seo_title_template,
    seoDefaultDescription: data.seo_default_description,
    seoOgTitle: data.seo_og_title ?? "",
  });
  return parsed.success ? parsed.data : defaultSiteSettings;
}
