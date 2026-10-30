import "server-only";

import type { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import type { Locale } from "@/i18n/config";
import { localizeContent, localizeLocation, localizeText, translationFor } from "@/i18n/localize-content";
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

/**
 * Content for the editor in a given language. English is the stored row;
 * Dutch is what visitors currently see in Dutch (saved translation → known
 * Dutch rendering → English), so the editor starts from the effective text.
 */
async function loadFor<S extends z.ZodType>(
  key: "home" | "about" | "contact",
  schema: S,
  fallback: z.infer<S>,
  locale: Locale,
): Promise<z.infer<S>> {
  const { supabase } = await requireAdmin();
  // select("*") keeps the editor working before the translations migration is applied.
  const { data, error } = await supabase.from("site_content").select("*").eq("key", key).maybeSingle();
  if (error) {
    console.error(`[admin] failed to load "${key}":`, error.message);
    throw new Error("Content unavailable");
  }
  const parsed = schema.safeParse(data?.content);
  const base = parsed.success ? parsed.data : fallback;
  return localizeContent(locale, base, translationFor(data?.translations, locale));
}

export const loadHomeContentFor = (locale: Locale): Promise<HomeContent> =>
  loadFor("home", homeContentSchema, defaultHomeContent, locale);
export const loadAboutContentFor = (locale: Locale): Promise<AboutContent> =>
  loadFor("about", aboutContentSchema, defaultAboutContent, locale);
export const loadContactContentFor = (locale: Locale): Promise<ContactContent> =>
  loadFor("contact", contactContentSchema, defaultContactContent, locale);

export async function loadSettingsFor(locale: Locale): Promise<SiteSettings> {
  const base = await loadSettings();
  if (locale === "en") return base;
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("site_settings").select("*").maybeSingle();
  const nl = translationFor(data?.translations, "nl") as Record<string, unknown> | undefined;
  return {
    ...base,
    location: localizeLocation("nl", base.location, nl?.location),
    seoDefaultTitle: localizeText("nl", base.seoDefaultTitle, nl?.seoDefaultTitle),
    seoTitleTemplate: localizeText("nl", base.seoTitleTemplate, nl?.seoTitleTemplate),
    seoDefaultDescription: localizeText("nl", base.seoDefaultDescription, nl?.seoDefaultDescription),
    seoOgTitle: localizeText("nl", base.seoOgTitle, nl?.seoOgTitle),
  };
}
