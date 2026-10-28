/**
 * Project model. Shaped so each field maps onto a database column (or a
 * jsonb column for `gallery` / `heroMedia`) when Supabase lands in P1.
 */

export type ProjectMediaType = "image" | "gif" | "video";

export type ProjectMedia = {
  type: ProjectMediaType;
  src: string;
  alt?: string;
  /** Still frame shown before a video plays. */
  poster?: string;
  width?: number;
  height?: number;
};

/**
 * How the "live preview" is presented.
 * - embed:    iframe of the live site (only when the site allows framing)
 * - media:    screenshots / GIFs / videos from the gallery
 * - external: open the live site in a new tab
 */
export type PreviewMode = "embed" | "media" | "external";

/** Drives the Selected Work filters. */
export type ProjectKind = "website" | "web-app" | "redesign" | "concept";

export type ProjectType = "client" | "personal" | "concept";

export type Project = {
  id: string;
  slug: string;
  title: string;
  subtitle?: string;
  shortDescription: string;
  description?: string;
  /** Industry / descriptor shown under the title, e.g. "Creative Audio Software". */
  category: string;
  kind: ProjectKind;
  /** Disciplines, e.g. "Web Design", "Development". */
  tags: string[];
  technologies: string[];
  keyFeatures: string[];

  year?: number;
  client?: string;
  projectType?: ProjectType;

  thumbnail: string;
  heroMedia?: ProjectMedia;
  gallery: ProjectMedia[];

  liveUrl?: string;
  previewUrl?: string;
  previewMode: PreviewMode;
  githubUrl?: string;

  featured: boolean;
  published: boolean;
  sortOrder: number;
};
