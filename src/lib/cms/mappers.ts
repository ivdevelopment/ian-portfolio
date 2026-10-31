import type { Locale } from "@/i18n/config";
import { dutchDescriptor } from "@/i18n/known-dutch";
import { translationFor } from "@/i18n/localize-content";
import type { Database } from "@/types/database";
import type { Project, ProjectMedia } from "@/types/project";

type Tables = Database["public"]["Tables"];
export type MediaRow = Tables["project_media"]["Row"];
export type FeatureRow = Tables["project_features"]["Row"];
export type ProjectRow = Tables["projects"]["Row"] & {
  project_media?: MediaRow[] | null;
  project_features?: FeatureRow[] | null;
};

export const PLACEHOLDER_THUMBNAIL = "/media/projects/placeholder.svg";

/**
 * Turns a stored path into something an <img> can load.
 * - absolute http(s) URL or app-relative "/media/…" path: returned as is
 * - otherwise a key inside a public bucket (`projects/…` -> project-media, `reviews/…` and `site/…` -> site-media)
 */
/** Which public bucket holds a storage key, by its folder. */
export function bucketForPath(path: string): "project-media" | "site-media" {
  return path.startsWith("reviews/") || path.startsWith("site/") ? "site-media" : "project-media";
}

export function resolveMediaUrl(
  path: string | null | undefined,
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path) || path.startsWith("/")) return path;
  const base = (supabaseUrl ?? "").replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${bucketForPath(path)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function mediaRowToMedia(row: MediaRow): ProjectMedia | null {
  const src = resolveMediaUrl(row.storage_path ?? row.external_url);
  if (!src) return null;
  return {
    type: row.type,
    src,
    alt: row.alt ?? undefined,
    poster: resolveMediaUrl(row.poster_path),
  };
}

/**
 * Maps a database row to a Project. The stored columns are the English copy;
 * for another language the saved translation is applied on top, field by field
 * (an empty field falls back to English). Brand and product names are kept as
 * saved, descriptions are never machine-translated, and only short, known
 * descriptors (category, subtitle, tags) get a built-in Dutch rendering.
 */
export function rowToProject(row: ProjectRow, locale: Locale = "en"): Project {
  const nl = locale === "nl" ? (translationFor(row.translations, "nl") as Partial<Record<string, unknown>> | undefined) : undefined;
  const pick = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() !== "" ? value : undefined;

  const media = [...(row.project_media ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const captions = (nl?.captions ?? {}) as Record<string, unknown>;
  const gallery = media
    .map((m): ProjectMedia | null => {
      const item = mediaRowToMedia(m);
      return item && { ...item, alt: pick(captions[m.id]) ?? item.alt };
    })
    .filter((m): m is ProjectMedia => m !== null);
  const features = [...(row.project_features ?? [])].sort((a, b) => a.sort_order - b.sort_order);

  const firstStill = gallery.find((m) => m.type === "image" || m.type === "gif");
  const thumbnail = resolveMediaUrl(row.thumbnail_path) ?? firstStill?.src ?? PLACEHOLDER_THUMBNAIL;
  const heroSource = gallery.find((m) => m.src === thumbnail && m.type !== "video") ?? firstStill;

  const baseFeatures = features.map((f) => f.label);
  const nlFeatures = Array.isArray(nl?.features)
    ? (nl.features as unknown[]).filter((f): f is string => typeof f === "string" && f.trim() !== "")
    : [];

  return {
    id: row.id,
    slug: row.slug,
    title: pick(nl?.title) ?? row.title,
    subtitle:
      pick(nl?.subtitle) ?? (row.subtitle ? (locale === "nl" ? dutchDescriptor(row.subtitle) : row.subtitle) : undefined),
    shortDescription: pick(nl?.shortDescription) ?? row.short_description,
    description: pick(nl?.description) ?? row.description ?? undefined,
    category: pick(nl?.category) ?? (locale === "nl" ? dutchDescriptor(row.category) : row.category),
    kind: row.kind,
    tags: locale === "nl" ? row.tags.map(dutchDescriptor) : row.tags,
    technologies: row.technologies,
    keyFeatures: nlFeatures.length > 0 ? nlFeatures : baseFeatures,
    year: row.year ?? undefined,
    client: row.client ?? undefined,
    projectType: row.project_type ?? undefined,
    thumbnail,
    heroMedia: heroSource,
    gallery,
    liveUrl: row.live_url ?? undefined,
    previewUrl: row.preview_url ?? undefined,
    githubUrl: row.github_url ?? undefined,
    previewMode: row.preview_mode,
    featured: row.featured,
    published: row.published,
    isExample: row.is_example,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  };
}

/** Nested select used wherever a project is loaded with its media and features. */
export const PROJECT_SELECT = "*, project_media(*), project_features(*)";
