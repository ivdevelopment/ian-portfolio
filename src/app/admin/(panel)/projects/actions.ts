"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { PROJECT_SELECT, type ProjectRow } from "@/lib/cms/mappers";
import { rowToEditorValues, toSavePayload } from "@/lib/cms/editor";
import { MEDIA_RULES, isStoragePathForProject, storagePathFor } from "@/lib/media-rules";
import { PROJECTS_TAG, projectTag } from "@/lib/projects";
import { projectEditorSchema } from "@/lib/schemas/project";
import { MEDIA_BUCKET } from "@/lib/supabase/env";
import { uniqueSlug } from "@/lib/slug";

export type ActionResult<T extends object = object> =
  | ({ ok: true; warning?: string } & T)
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const idSchema = z.uuid();

/** Make every public page that shows projects pick up the change. */
function invalidatePublicProjects(...slugs: Array<string | undefined>) {
  updateTag(PROJECTS_TAG);
  for (const slug of new Set(slugs)) {
    if (slug) updateTag(projectTag(slug));
  }
}

async function removeFromStorage(
  supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"],
  paths: string[],
): Promise<number> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return 0;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).remove(unique);
  if (error) {
    console.error("[projects] storage cleanup failed:", error.message);
    return unique.length;
  }
  return 0;
}

function dbError(error: { code?: string; message: string }): ActionResult {
  if (error.code === "23505") {
    return {
      ok: false,
      error: "That slug is already used by another project.",
      fieldErrors: { slug: "That slug is already used by another project." },
    };
  }
  if (error.code === "42501") return { ok: false, error: "You don't have permission to do that." };
  console.error("[projects] database error:", error.code, error.message);
  return { ok: false, error: "The project couldn't be saved. Please try again." };
}

/** Create or update a project — the whole editor state is saved in one transaction. */
export async function saveProjectAction(
  input: unknown,
): Promise<ActionResult<{ id: string; slug: string }>> {
  const { supabase } = await requireAdmin();

  const parsed = projectEditorSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const values = parsed.data;

  // Media sources must live under this project's own folder, with a matching type.
  for (const m of values.media) {
    if (m.storagePath) {
      if (!isStoragePathForProject(m.storagePath, values.id)) {
        return { ok: false, error: "A media file doesn't belong to this project." };
      }
      const ext = m.storagePath.split(".").pop();
      const expected = Object.values(MEDIA_RULES).find((r) => r.ext === ext)?.type;
      if (expected !== m.type) {
        return { ok: false, error: "A media file's type doesn't match its extension." };
      }
    }
    if (m.posterPath && !isStoragePathForProject(m.posterPath, values.id)) {
      return { ok: false, error: "A poster image doesn't belong to this project." };
    }
  }
  const stills = new Set(
    values.media
      .filter((m) => m.type !== "video")
      .map((m) => m.storagePath ?? m.externalUrl)
      .filter((p): p is string => Boolean(p)),
  );
  if (values.thumbnailPath && !stills.has(values.thumbnailPath)) {
    return { ok: false, error: "The thumbnail must be one of this project's images." };
  }

  // What exists today (to clean up removed files, and to expire the old slug's cache).
  const { data: existing } = await supabase
    .from("projects")
    .select("slug, project_media(storage_path, poster_path)")
    .eq("id", values.id)
    .maybeSingle();

  const payload = toSavePayload(values);
  const { error } = await supabase.rpc("save_project", {
    p_id: values.id,
    p_project: payload.project,
    p_features: payload.features,
    p_media: payload.media,
  });
  if (error) return dbError(error) as ActionResult<{ id: string; slug: string }>;

  // Remove files that were dropped from the project (best effort).
  const kept = new Set(
    values.media.flatMap((m) => [m.storagePath, m.posterPath].filter((p): p is string => Boolean(p))),
  );
  const stale = (existing?.project_media ?? [])
    .flatMap((m) => [m.storage_path, m.poster_path])
    .filter((p): p is string => Boolean(p))
    .filter((p) => !kept.has(p));
  const failedRemovals = await removeFromStorage(supabase, stale);

  invalidatePublicProjects(values.slug, existing?.slug);

  return {
    ok: true,
    id: values.id,
    slug: values.slug,
    warning:
      failedRemovals > 0
        ? `Saved, but ${failedRemovals} removed file(s) couldn't be deleted from storage.`
        : undefined,
  };
}

export async function setPublishedAction(id: string, published: boolean): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Invalid project." };

  const { data, error } = await supabase
    .from("projects")
    .update({ published })
    .eq("id", id)
    .select("slug")
    .maybeSingle();
  if (error) return dbError(error);
  if (!data) return { ok: false, error: "Project not found." };

  invalidatePublicProjects(data.slug);
  return { ok: true };
}

export async function setFeaturedAction(id: string, featured: boolean): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Invalid project." };

  const { data, error } = await supabase
    .from("projects")
    .update({ featured })
    .eq("id", id)
    .select("slug")
    .maybeSingle();
  if (error) return dbError(error);
  if (!data) return { ok: false, error: "Project not found." };

  invalidatePublicProjects(data.slug);
  return { ok: true };
}

/**
 * Deletes the project row (media/feature rows cascade), then its Storage
 * files. If some files can't be removed the project is still gone and the
 * result carries a warning, so nothing is half-deleted silently.
 */
export async function deleteProjectAction(id: string): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Invalid project." };

  const { data: project } = await supabase
    .from("projects")
    .select("slug, project_media(storage_path, poster_path)")
    .eq("id", id)
    .maybeSingle();
  if (!project) return { ok: false, error: "Project not found." };

  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) return dbError(error);

  const paths = project.project_media.flatMap((m) => [m.storage_path, m.poster_path]).filter(
    (p): p is string => Boolean(p),
  );
  const failed = await removeFromStorage(supabase, paths);

  invalidatePublicProjects(project.slug);
  return {
    ok: true,
    warning:
      failed > 0
        ? `The project was deleted, but ${failed} file(s) couldn't be removed from storage.`
        : undefined,
  };
}

/** Copies a project (and its Storage files) into a new, unpublished draft. */
export async function duplicateProjectAction(id: string): Promise<ActionResult<{ id: string }>> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Invalid project." };

  const { data: source } = await supabase
    .from("projects")
    .select(PROJECT_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (!source) return { ok: false, error: "Project not found." };

  const { data: slugs } = await supabase.from("projects").select("slug");
  const values = rowToEditorValues(source as ProjectRow);
  const newId = crypto.randomUUID();
  let skipped = 0;

  const media: typeof values.media = [];
  let thumbnailPath: string | null = null;
  for (const m of values.media) {
    const copy = { ...m, mediaId: crypto.randomUUID() };
    if (m.storagePath) {
      const ext = m.storagePath.split(".").pop() ?? "";
      const target = storagePathFor(newId, ext, crypto.randomUUID());
      const { error } = await supabase.storage.from(MEDIA_BUCKET).copy(m.storagePath, target);
      if (error) {
        skipped++;
        continue;
      }
      copy.storagePath = target;
      if (values.thumbnailPath === m.storagePath) thumbnailPath = target;
    } else if (values.thumbnailPath && values.thumbnailPath === m.externalUrl) {
      thumbnailPath = m.externalUrl;
    }
    if (m.posterPath) {
      const target = storagePathFor(newId, "jpg", crypto.randomUUID());
      const { error } = await supabase.storage.from(MEDIA_BUCKET).copy(m.posterPath, target);
      copy.posterPath = error ? null : target;
    }
    media.push(copy);
  }

  const copyValues = {
    ...values,
    id: newId,
    title: `${values.title} (copy)`,
    slug: uniqueSlug(`${values.slug}-copy`, (slugs ?? []).map((s) => s.slug)),
    published: false,
    featured: false,
    media,
    thumbnailPath,
  };

  const payload = toSavePayload(copyValues);
  const { error } = await supabase.rpc("save_project", {
    p_id: newId,
    p_project: payload.project,
    p_features: payload.features,
    p_media: payload.media,
  });
  if (error) {
    // Don't leave orphaned copies behind.
    await removeFromStorage(
      supabase,
      media.flatMap((m) => [m.storagePath, m.posterPath].filter((p): p is string => Boolean(p))),
    );
    return dbError(error) as ActionResult<{ id: string }>;
  }

  return {
    ok: true,
    id: newId,
    warning: skipped > 0 ? `${skipped} media file(s) couldn't be copied.` : undefined,
  };
}
