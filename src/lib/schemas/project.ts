import { z } from "zod";
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from "@/lib/slug";

export const PROJECT_KINDS = ["website", "web-app", "redesign", "concept"] as const;
export const PROJECT_TYPE_VALUES = ["client", "personal", "concept"] as const;
export const PREVIEW_MODES = ["embed", "media", "external"] as const;
export const MEDIA_TYPES = ["image", "gif", "video"] as const;

export const KIND_LABELS: Record<(typeof PROJECT_KINDS)[number], string> = {
  website: "Website",
  "web-app": "Web app",
  redesign: "Redesign",
  concept: "Concept",
};

export const PROJECT_TYPE_LABELS: Record<(typeof PROJECT_TYPE_VALUES)[number], string> = {
  client: "Client project",
  personal: "Personal project",
  concept: "Concept",
};

/** http(s) only — rejects javascript:, data:, etc. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export const slugSchema = z
  .string()
  .trim()
  .min(1, "Slug is required.")
  .max(SLUG_MAX_LENGTH, `Keep the slug under ${SLUG_MAX_LENGTH} characters.`)
  .regex(SLUG_PATTERN, "Use lowercase letters, numbers and single hyphens only.");

const optionalUrl = z
  .string()
  .trim()
  .max(500, "That URL is too long.")
  .refine((v) => v === "" || isHttpUrl(v), "Enter a full URL starting with https://");

/** Media source stored on a project: a Storage path or an https/app-relative URL. */
const mediaItemSchema = z
  .object({
    mediaId: z.uuid(),
    type: z.enum(MEDIA_TYPES),
    storagePath: z.string().max(300).nullable(),
    externalUrl: z
      .string()
      .max(500)
      .refine((v) => /^https:\/\//.test(v) || /^\/media\//.test(v), "Use an https:// URL.")
      .nullable(),
    alt: z.string().trim().max(300, "Alt text is limited to 300 characters."),
    posterPath: z.string().max(300).nullable(),
  })
  .refine((m) => (m.storagePath === null) !== (m.externalUrl === null), {
    message: "A media item needs exactly one source.",
  });

const chip = z.string().trim().min(1).max(40, "Keep each item under 40 characters.");

export const projectEditorSchema = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1, "Title is required.").max(120, "Keep the title under 120 characters."),
    slug: slugSchema,
    subtitle: z.string().trim().max(160, "Keep the subtitle under 160 characters."),
    shortDescription: z
      .string()
      .trim()
      .min(1, "A short description is required.")
      .max(400, "Keep the short description under 400 characters."),
    description: z.string().trim().max(8000, "Keep the description under 8000 characters."),
    category: z.string().trim().min(1, "Category is required.").max(80),
    kind: z.enum(PROJECT_KINDS),
    year: z
      .string()
      .trim()
      .regex(/^(?:(?:19|20)\d{2})?$/, "Enter a four-digit year, e.g. 2026."),
    client: z.string().trim().max(120),
    projectType: z.union([z.enum(PROJECT_TYPE_VALUES), z.literal("")]),
    liveUrl: optionalUrl,
    previewUrl: optionalUrl,
    githubUrl: optionalUrl,
    previewMode: z.enum(PREVIEW_MODES),
    tags: z.array(chip).max(12, "Use at most 12 tags."),
    technologies: z.array(chip).max(16, "Use at most 16 technologies."),
    features: z
      .array(z.object({ label: z.string().trim().min(1, "Enter a feature or remove it.").max(160) }))
      .max(20, "Use at most 20 features."),
    media: z.array(mediaItemSchema).max(40, "Use at most 40 media items."),
    thumbnailPath: z.string().max(500).nullable(),
    published: z.boolean(),
    featured: z.boolean(),
    isExample: z.boolean(),
    sortOrder: z.number().int().min(0).max(9999),
  })
  .superRefine((p, ctx) => {
    if (p.previewMode === "embed" && !p.previewUrl && !p.liveUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["previewUrl"],
        message: "Embed needs a preview URL (or a live URL).",
      });
    }
    if (p.previewMode === "external" && !p.liveUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["liveUrl"],
        message: "External preview needs a live URL.",
      });
    }
  });

export type ProjectEditorValues = z.infer<typeof projectEditorSchema>;
export type MediaItemValues = ProjectEditorValues["media"][number];
