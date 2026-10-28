import { cacheLife, cacheTag } from "next/cache";
import type { z } from "zod";
import {
  defaultAboutContent,
  defaultContactContent,
  defaultHomeContent,
  defaultSiteSettings,
} from "@/data/default-content";
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

function parseOrDefault<S extends z.ZodType>(schema: S, value: unknown, fallback: z.infer<S>, label: string): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  console.error(`[site-content] "${label}" is invalid, using defaults:`, parsed.error.issues[0]?.message);
  return fallback;
}

async function readContent(key: "home" | "about" | "contact"): Promise<unknown> {
  const { data, error } = await createPublicClient()
    .from("site_content")
    .select("content")
    .eq("key", key)
    .maybeSingle();
  if (error) {
    console.error(`[site-content] failed to load "${key}":`, error.message);
    throw new Error("Site content is temporarily unavailable.");
  }
  return data?.content ?? null;
}

export async function getSiteSettings(): Promise<SiteSettings> {
  "use cache";
  cacheTag(SITE_SETTINGS_TAG);
  cacheLife("hours");

  const { data, error } = await createPublicClient().from("site_settings").select("*").maybeSingle();
  if (error) {
    console.error("[site-content] failed to load settings:", error.message);
    throw new Error("Site settings are temporarily unavailable.");
  }
  if (!data) return defaultSiteSettings;

  return parseOrDefault(
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
}

export async function getHomeContent(): Promise<HomeContent> {
  "use cache";
  cacheTag(SITE_CONTENT_TAG);
  cacheLife("hours");
  return parseOrDefault(homeContentSchema, await readContent("home"), defaultHomeContent, "home");
}

export async function getAboutContent(): Promise<AboutContent> {
  "use cache";
  cacheTag(SITE_CONTENT_TAG);
  cacheLife("hours");
  return parseOrDefault(aboutContentSchema, await readContent("about"), defaultAboutContent, "about");
}

export async function getContactContent(): Promise<ContactContent> {
  "use cache";
  cacheTag(SITE_CONTENT_TAG);
  cacheLife("hours");
  return parseOrDefault(contactContentSchema, await readContent("contact"), defaultContactContent, "contact");
}

/** Enabled services, in the admin's order (RLS already hides disabled ones from visitors). */
export async function getServices(): Promise<ServiceItem[]> {
  "use cache";
  cacheTag(SERVICES_TAG);
  cacheLife("hours");

  const { data, error } = await createPublicClient()
    .from("services")
    .select("id, slug, title, description, icon, includes, enabled")
    .eq("enabled", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[site-content] failed to load services:", error.message);
    throw new Error("Services are temporarily unavailable.");
  }

  return data.map((s) => ({
    id: s.id,
    slug: s.slug,
    title: s.title,
    description: s.description,
    icon: s.icon as ServiceItem["icon"],
    includes: s.includes.map((label) => ({ label })),
    enabled: s.enabled,
  }));
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
