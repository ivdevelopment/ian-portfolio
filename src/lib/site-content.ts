import { cacheLife, cacheTag } from "next/cache";
import type { z } from "zod";
import {
  defaultAboutContent,
  defaultContactContent,
  defaultHomeContent,
  defaultSiteSettings,
} from "@/data/default-content";
import type { Locale } from "@/i18n/config";
import { localizeContent, localizeLocation, localizeText, translationFor } from "@/i18n/localize-content";
import { publicEmail } from "@/lib/placeholder-email";
import { createPublicClient } from "@/lib/supabase/public";
import {
  aboutContentSchema,
  contactContentSchema,
  homeContentSchema,
  siteSettingsSchema,
  type AboutContent,
  type ContactContent,
  type HomeContent,
  type ServiceItem,
  type SiteSettings,
  type SkillItem,
} from "@/lib/schemas/site-content";

/**
 * Public, cached reads of CMS-managed site content. Each family has its own
 * cache tag so the admin can expire exactly what changed:
 *   site-settings -> settings / SEO / footer / contact details
 *   site-content  -> home, about and contact copy
 *   services, skills
 * A query error throws (so a failure is never cached as "no content"); a row
 * that is missing or invalid falls back to the structural defaults.
 */

export const SITE_SETTINGS_TAG = "site-settings";
export const SITE_CONTENT_TAG = "site-content";
export const SERVICES_TAG = "services";
export const SKILLS_TAG = "skills";

/** Every cached read carries its family tag AND a per-language tag, so Dutch and English expire independently. */
export const localeTag = (tag: string, locale: Locale) => `${tag}:${locale}`;

function parseOrDefault<S extends z.ZodType>(schema: S, value: unknown, fallback: z.infer<S>, label: string): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  console.error(`[site-content] "${label}" is invalid, using defaults:`, parsed.error.issues[0]?.message);
  return fallback;
}

async function readContent(
  key: "home" | "about" | "contact",
): Promise<{ content: unknown; translations: unknown }> {
  const { data, error } = await createPublicClient()
    .from("site_content")
    .select("*")
    .eq("key", key)
    .maybeSingle();
  if (error) {
    console.error(`[site-content] failed to load "${key}":`, error.message);
    throw new Error("Site content is temporarily unavailable.");
  }
  return { content: data?.content ?? null, translations: data?.translations ?? {} };
}

export async function getSiteSettings(locale: Locale): Promise<SiteSettings> {
  "use cache";
  cacheTag(SITE_SETTINGS_TAG, localeTag(SITE_SETTINGS_TAG, locale));
  cacheLife("hours");

  const { data, error } = await createPublicClient().from("site_settings").select("*").maybeSingle();
  if (error) {
    console.error("[site-content] failed to load settings:", error.message);
    throw new Error("Site settings are temporarily unavailable.");
  }
  if (!data) return localizeContent(locale, defaultSiteSettings);

  const settings = parseOrDefault(
    siteSettingsSchema,
    {
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
    },
    defaultSiteSettings,
    "site_settings",
  );
  // Dutch: saved translation → known rendering → English. Names, links and email are never translated.
  const nl = translationFor(data.translations, locale) as Record<string, unknown> | undefined;
  return {
    ...settings,
    location: localizeLocation(locale, settings.location, nl?.location),
    seoDefaultTitle: localizeText(locale, settings.seoDefaultTitle, nl?.seoDefaultTitle),
    seoTitleTemplate: localizeText(locale, settings.seoTitleTemplate, nl?.seoTitleTemplate),
    seoDefaultDescription: localizeText(locale, settings.seoDefaultDescription, nl?.seoDefaultDescription),
    seoOgTitle: localizeText(locale, settings.seoOgTitle, nl?.seoOgTitle),
    // Public pages never show a seeded placeholder address as contact information.
    contactEmail: publicEmail(settings.contactEmail),
  };
}

export async function getHomeContent(locale: Locale): Promise<HomeContent> {
  "use cache";
  cacheTag(SITE_CONTENT_TAG, localeTag(SITE_CONTENT_TAG, locale));
  cacheLife("hours");
  const { content, translations } = await readContent("home");
  const base = parseOrDefault(homeContentSchema, content, defaultHomeContent, "home");
  return localizeContent(locale, base, translationFor(translations, locale));
}

export async function getAboutContent(locale: Locale): Promise<AboutContent> {
  "use cache";
  cacheTag(SITE_CONTENT_TAG, localeTag(SITE_CONTENT_TAG, locale));
  cacheLife("hours");
  const { content, translations } = await readContent("about");
  const base = parseOrDefault(aboutContentSchema, content, defaultAboutContent, "about");
  return localizeContent(locale, base, translationFor(translations, locale));
}

export async function getContactContent(locale: Locale): Promise<ContactContent> {
  "use cache";
  cacheTag(SITE_CONTENT_TAG, localeTag(SITE_CONTENT_TAG, locale));
  cacheLife("hours");
  const { content, translations } = await readContent("contact");
  const base = parseOrDefault(contactContentSchema, content, defaultContactContent, "contact");
  return localizeContent(locale, base, translationFor(translations, locale));
}

/** Enabled services, in the admin's order (RLS already hides disabled ones from visitors). */
export async function getServices(locale: Locale): Promise<ServiceItem[]> {
  "use cache";
  cacheTag(SERVICES_TAG, localeTag(SERVICES_TAG, locale));
  cacheLife("hours");

  const { data, error } = await createPublicClient()
    .from("services")
    .select("*")
    .eq("enabled", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[site-content] failed to load services:", error.message);
    throw new Error("Services are temporarily unavailable.");
  }

  return data.map((s) => {
    const base: ServiceItem = {
      id: s.id,
      slug: s.slug,
      title: s.title,
      description: s.description,
      icon: s.icon as ServiceItem["icon"],
      includes: s.includes.map((label) => ({ label })),
      enabled: s.enabled,
    };
    // translations.nl = { title, description, includes: ["…"] } (the includes list is matched by position).
    const nl = translationFor(s.translations, locale) as
      | { title?: unknown; description?: unknown; includes?: unknown }
      | undefined;
    const includesOverride = Array.isArray(nl?.includes) ? nl.includes.map((label) => ({ label })) : undefined;
    return localizeContent(locale, base, { title: nl?.title, description: nl?.description, includes: includesOverride });
  });
}

export async function getSkills(): Promise<SkillItem[]> {
  "use cache";
  cacheTag(SKILLS_TAG);
  cacheLife("hours");

  const { data, error } = await createPublicClient()
    .from("skills")
    .select("id, name, enabled")
    .eq("enabled", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[site-content] failed to load skills:", error.message);
    throw new Error("Skills are temporarily unavailable.");
  }
  return data;
}
