import type { ProjectMediaType } from "@/types/project";

const MiB = 1024 * 1024;

/**
 * Upload rules, shared by the admin UI and server validation. The Storage
 * bucket enforces the MIME list and the 50 MiB ceiling independently.
 */
export const MEDIA_RULES = {
  "image/png": { type: "image", ext: "png", maxBytes: 10 * MiB },
  "image/jpeg": { type: "image", ext: "jpg", maxBytes: 10 * MiB },
  "image/webp": { type: "image", ext: "webp", maxBytes: 10 * MiB },
  "image/gif": { type: "gif", ext: "gif", maxBytes: 15 * MiB },
  "video/mp4": { type: "video", ext: "mp4", maxBytes: 50 * MiB },
} as const satisfies Record<string, { type: ProjectMediaType; ext: string; maxBytes: number }>;

export type AllowedMime = keyof typeof MEDIA_RULES;

export const ACCEPT_ATTRIBUTE = Object.keys(MEDIA_RULES).join(",");
export const POSTER_ACCEPT_ATTRIBUTE = "image/png,image/jpeg,image/webp";

export function formatBytes(bytes: number): string {
  if (bytes >= MiB) return `${(bytes / MiB).toFixed(bytes % MiB === 0 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export type FileCheck =
  | { ok: true; type: ProjectMediaType; ext: string }
  | { ok: false; error: string };

/** Validates a file's declared MIME type and size. Pass `imagesOnly` for posters. */
export function checkUpload(
  file: { type: string; size: number; name: string },
  options: { imagesOnly?: boolean } = {},
): FileCheck {
  const rule = (MEDIA_RULES as Record<string, (typeof MEDIA_RULES)[AllowedMime]>)[file.type];
  if (!rule) {
    return {
      ok: false,
      error: `${file.name}: unsupported file type. Use PNG, JPG, WebP, GIF or MP4.`,
    };
  }
  if (options.imagesOnly && rule.type !== "image") {
    return { ok: false, error: `${file.name}: posters must be PNG, JPG or WebP.` };
  }
  if (file.size <= 0) return { ok: false, error: `${file.name}: the file is empty.` };
  if (file.size > rule.maxBytes) {
    return {
      ok: false,
      error: `${file.name}: too large (${formatBytes(file.size)}). The limit for this type is ${formatBytes(rule.maxBytes)}.`,
    };
  }
  return { ok: true, type: rule.type, ext: rule.ext };
}

/** Storage keys are `projects/<project-id>/<uuid>.<ext>` — stable and collision-free. */
export function storagePathFor(projectId: string, ext: string, id: string): string {
  return `projects/${projectId}/${id}.${ext}`;
}

export function isStoragePathForProject(path: string, projectId: string): boolean {
  return (
    path.startsWith(`projects/${projectId}/`) &&
    !path.includes("..") &&
    /^projects\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp|gif|mp4)$/.test(path)
  );
}
