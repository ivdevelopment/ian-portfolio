"use server";

import { updateTag } from "next/cache";
import type { ZodType } from "zod";
import { requireAdmin } from "@/lib/auth";
import {
  SERVICES_TAG,
  SITE_CONTENT_TAG,
  SITE_SETTINGS_TAG,
  SKILLS_TAG,
  localeTag,
} from "@/lib/site-content";
import {
  aboutContentSchema,
  contactContentSchema,
  homeContentSchema,
  servicesListSchema,
  servicesTranslationSchema,
  siteSettingsSchema,
  skillsListSchema,
} from "@/lib/schemas/site-content";
import { SITE_BUCKET } from "@/lib/supabase/env";

export type ContentActionResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

function issues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): ContentActionResult {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
}

/** Every `site/…` Storage path mentioned anywhere in a JSON value. */
function storagePathsIn(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    if (value.startsWith("site/")) found.add(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => storagePathsIn(v, found));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => storagePathsIn(v, found));
  }
  return found;
}

async function saveContent<S extends ZodType>(
  key: "home" | "about" | "contact",
  schema: S,
  input: unknown,
): Promise<ContentActionResult> {
  const { supabase } = await requireAdmin();

  const parsed = schema.safeParse(input);
  if (!parsed.success) return issues(parsed.error);

  const { data: previous } = await supabase
    .from("site_content")
    .select("content")
    .eq("key", key)
    .maybeSingle();

  const { error } = await supabase
    .from("site_content")
    .upsert({ key, content: parsed.data as never });
  if (error) {
    console.error(`[site-content] saving "${key}" failed:`, error.code, error.message);
    return { ok: false, error: "The content couldn't be saved. Please try again." };
  }

  // Remove uploaded images that are no longer referenced (best effort).
  const before = storagePathsIn(previous?.content);
  const after = storagePathsIn(parsed.data);
  const stale = [...before].filter((p) => !after.has(p));
  let warning: string | undefined;
  if (stale.length > 0) {
    const { error: removeError } = await supabase.storage.from(SITE_BUCKET).remove(stale);
    if (removeError) {
      console.error("[site-content] image cleanup failed:", removeError.message);
      warning = "Saved, but an old image couldn't be removed from storage.";
    }
  }

  updateTag(SITE_CONTENT_TAG);
  return { ok: true, warning };
}

export async function saveHomeContentAction(input: unknown) {
  return saveContent("home", homeContentSchema, input);
}

export async function saveAboutContentAction(input: unknown) {
  return saveContent("about", aboutContentSchema, input);
}

export async function saveContactContentAction(input: unknown) {
  return saveContent("contact", contactContentSchema, input);
}

export async function saveSettingsAction(input: unknown): Promise<ContentActionResult> {
  const { supabase } = await requireAdmin();

  const parsed = siteSettingsSchema.safeParse(input);
  if (!parsed.success) return issues(parsed.error);
  const v = parsed.data;

  const { error } = await supabase
    .from("site_settings")
    .upsert({
      id: true,
      site_name: v.siteName,
      display_name: v.displayName,
      location: v.location || null,
      contact_email: v.contactEmail || null,
      github_url: v.githubUrl || null,
      linkedin_url: v.linkedinUrl || null,
      instagram_url: v.instagramUrl || null,
      x_url: v.xUrl || null,
      seo_default_title: v.seoDefaultTitle,
      seo_title_template: v.seoTitleTemplate,
      seo_default_description: v.seoDefaultDescription,
      seo_og_title: v.seoOgTitle || null,
    });
  if (error) {
    console.error("[settings] save failed:", error.code, error.message);
    return { ok: false, error: "The settings couldn't be saved. Please try again." };
  }

  updateTag(SITE_SETTINGS_TAG);
  return { ok: true };
}

export async function saveServicesAction(input: unknown): Promise<ContentActionResult> {
  const { supabase } = await requireAdmin();

  const parsed = servicesListSchema.safeParse(input);
  if (!parsed.success) return issues(parsed.error);

  const { error } = await supabase.rpc("save_services", {
    p_services: parsed.data.map((s) => ({
      id: s.id,
      slug: s.slug,
      title: s.title,
      description: s.description,
      icon: s.icon,
      includes: s.includes.map((i) => i.label),
      enabled: s.enabled,
    })),
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Each service needs a unique slug." };
    console.error("[services] save failed:", error.code, error.message);
    return { ok: false, error: "The services couldn't be saved. Please try again." };
  }

  updateTag(SERVICES_TAG);
  return { ok: true };
}

export async function saveSkillsAction(input: unknown): Promise<ContentActionResult> {
  const { supabase } = await requireAdmin();

  const parsed = skillsListSchema.safeParse(input);
  if (!parsed.success) return issues(parsed.error);

  const { error } = await supabase.rpc("save_skills", { p_skills: parsed.data });
  if (error) {
    console.error("[skills] save failed:", error.code, error.message);
    return { ok: false, error: "The skills couldn't be saved. Please try again." };
  }

  updateTag(SKILLS_TAG);
  return { ok: true };
}

/* ------------------------------------------------------------------ translations */

const NEEDS_MIGRATION =
  "Translations can't be saved yet: apply the latest database migration (npx supabase db push) first.";

/** Postgres "undefined column" (migration not applied) → a clear message instead of a generic failure. */
function translationError(label: string, error: { code?: string; message: string }): ContentActionResult {
  console.error(`[${label}] translation save failed:`, error.code, error.message);
  if (error.code === "42703" || /translations/.test(error.message)) return { ok: false, error: NEEDS_MIGRATION };
  return { ok: false, error: "The translation couldn't be saved. Please try again." };
}

const contentSchemas = {
  home: homeContentSchema,
  about: aboutContentSchema,
  contact: contactContentSchema,
} as const;

/** Saves the Dutch version of a page. Links, images and numbers are read from the English row, never from here. */
export async function saveContentTranslationAction(
  key: "home" | "about" | "contact",
  input: unknown,
): Promise<ContentActionResult> {
  const { supabase } = await requireAdmin();
  if (!(key in contentSchemas)) return { ok: false, error: "Unknown page." };

  const parsed = contentSchemas[key].safeParse(input);
  if (!parsed.success) return issues(parsed.error);

  const { data: row, error: readError } = await supabase
    .from("site_content")
    .select("translations")
    .eq("key", key)
    .maybeSingle();
  if (readError) return translationError("site-content", readError);
  if (!row) return { ok: false, error: "Save the English version of this page first." };

  const { error } = await supabase
    .from("site_content")
    .update({ translations: { ...asRecord(row.translations), nl: parsed.data as never } })
    .eq("key", key);
  if (error) return translationError("site-content", error);

  updateTag(localeTag(SITE_CONTENT_TAG, "nl"));
  return { ok: true };
}

/** Dutch settings: only the SEO text and location are translatable; names, links and email are shared. */
export async function saveSettingsTranslationAction(input: unknown): Promise<ContentActionResult> {
  const { supabase } = await requireAdmin();

  const parsed = siteSettingsSchema.safeParse(input);
  if (!parsed.success) return issues(parsed.error);
  const v = parsed.data;

  const { data: row, error: readError } = await supabase.from("site_settings").select("translations").maybeSingle();
  if (readError) return translationError("settings", readError);
  if (!row) return { ok: false, error: "Save the English settings first." };

  const nl = {
    location: v.location,
    seoDefaultTitle: v.seoDefaultTitle,
    seoTitleTemplate: v.seoTitleTemplate,
    seoDefaultDescription: v.seoDefaultDescription,
    seoOgTitle: v.seoOgTitle,
  };
  const { error } = await supabase
    .from("site_settings")
    .update({ translations: { ...asRecord(row.translations), nl } })
    .eq("id", true);
  if (error) return translationError("settings", error);

  updateTag(localeTag(SITE_SETTINGS_TAG, "nl"));
  return { ok: true };
}

/** Dutch title, description and "includes" list per service (services themselves stay shared). */
export async function saveServicesTranslationAction(input: unknown): Promise<ContentActionResult> {
  const { supabase } = await requireAdmin();

  const parsed = servicesTranslationSchema.safeParse(input);
  if (!parsed.success) return issues(parsed.error);

  for (const item of parsed.data) {
    const { data: row, error: readError } = await supabase
      .from("services")
      .select("translations")
      .eq("id", item.id)
      .maybeSingle();
    if (readError) return translationError("services", readError);
    if (!row) continue;

    const nl = {
      title: item.title,
      description: item.description,
      includes: item.includesText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    };
    const { error } = await supabase
      .from("services")
      .update({ translations: { ...asRecord(row.translations), nl } })
      .eq("id", item.id);
    if (error) return translationError("services", error);
  }

  updateTag(localeTag(SERVICES_TAG, "nl"));
  return { ok: true };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
