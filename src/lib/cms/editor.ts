import type { Json } from "@/types/database";
import type { ProjectEditorValues } from "@/lib/schemas/project";
import type { ProjectRow } from "./mappers";

export function emptyEditorValues(id: string): ProjectEditorValues {
  return {
    id,
    title: "",
    slug: "",
    subtitle: "",
    shortDescription: "",
    description: "",
    category: "",
    kind: "website",
    year: "",
    client: "",
    projectType: "",
    liveUrl: "",
    previewUrl: "",
    githubUrl: "",
    previewMode: "media",
    tags: [],
    technologies: [],
    features: [],
    media: [],
    thumbnailPath: null,
    published: false,
    featured: false,
    isExample: false,
    sortOrder: 0,
  };
}

/** Loads a database row (with media + features) into the editor's form shape. */
export function rowToEditorValues(row: ProjectRow): ProjectEditorValues {
  const media = [...(row.project_media ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const features = [...(row.project_features ?? [])].sort((a, b) => a.sort_order - b.sort_order);

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    subtitle: row.subtitle ?? "",
    shortDescription: row.short_description,
    description: row.description ?? "",
    category: row.category,
    kind: row.kind,
    year: row.year ? String(row.year) : "",
    client: row.client ?? "",
    projectType: row.project_type ?? "",
    liveUrl: row.live_url ?? "",
    previewUrl: row.preview_url ?? "",
    githubUrl: row.github_url ?? "",
    previewMode: row.preview_mode,
    tags: row.tags,
    technologies: row.technologies,
    features: features.map((f) => ({ label: f.label })),
    media: media.map((m) => ({
      mediaId: m.id,
      type: m.type,
      storagePath: m.storage_path,
      externalUrl: m.external_url,
      alt: m.alt ?? "",
      posterPath: m.poster_path,
    })),
    thumbnailPath: row.thumbnail_path,
    published: row.published,
    featured: row.featured,
    isExample: row.is_example,
    sortOrder: row.sort_order,
  };
}

/** Arguments for the `save_project` database function. */
export function toSavePayload(v: ProjectEditorValues): {
  project: Json;
  features: Json;
  media: Json;
} {
  return {
    project: {
      slug: v.slug,
      title: v.title,
      subtitle: v.subtitle,
      short_description: v.shortDescription,
      description: v.description,
      category: v.category,
      kind: v.kind,
      year: v.year,
      client: v.client,
      project_type: v.projectType,
      thumbnail_path: v.thumbnailPath ?? "",
      tags: v.tags,
      technologies: v.technologies,
      live_url: v.liveUrl,
      preview_url: v.previewUrl,
      github_url: v.githubUrl,
      preview_mode: v.previewMode,
      featured: v.featured,
      published: v.published,
      is_example: v.isExample,
      sort_order: v.sortOrder,
    },
    features: v.features.map((f) => f.label),
    media: v.media.map((m) => ({
      id: m.mediaId,
      type: m.type,
      storage_path: m.storagePath ?? "",
      external_url: m.externalUrl ?? "",
      alt: m.alt,
      poster_path: m.posterPath ?? "",
    })),
  };
}
