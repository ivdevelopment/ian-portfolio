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
 * - otherwise a key inside the public `project-media` bucket
 */
export function resolveMediaUrl(
  path: string | null | undefined,
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path) || path.startsWith("/")) return path;
  const base = (supabaseUrl ?? "").replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/project-media/${path.split("/").map(encodeURIComponent).join("/")}`;
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

export function rowToProject(row: ProjectRow): Project {
  const media = [...(row.project_media ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const gallery = media.map(mediaRowToMedia).filter((m): m is ProjectMedia => m !== null);
  const features = [...(row.project_features ?? [])].sort((a, b) => a.sort_order - b.sort_order);

  const firstStill = gallery.find((m) => m.type === "image" || m.type === "gif");
  const thumbnail = resolveMediaUrl(row.thumbnail_path) ?? firstStill?.src ?? PLACEHOLDER_THUMBNAIL;
  const heroSource = gallery.find((m) => m.src === thumbnail && m.type !== "video") ?? firstStill;

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle ?? undefined,
    shortDescription: row.short_description,
    description: row.description ?? undefined,
    category: row.category,
    kind: row.kind,
    tags: row.tags,
    technologies: row.technologies,
    keyFeatures: features.map((f) => f.label),
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
