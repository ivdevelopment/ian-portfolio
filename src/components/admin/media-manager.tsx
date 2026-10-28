"use client";

import { useRef, useState } from "react";
import { useFieldArray, type UseFormReturn } from "react-hook-form";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Film,
  ImagePlus,
  Link2,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { MEDIA_BUCKET } from "@/lib/supabase/env";
import { resolveMediaUrl } from "@/lib/cms/mappers";
import {
  ACCEPT_ATTRIBUTE,
  MEDIA_RULES,
  POSTER_ACCEPT_ATTRIBUTE,
  checkUpload,
  formatBytes,
  storagePathFor,
} from "@/lib/media-rules";
import type { ProjectEditorValues } from "@/lib/schemas/project";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { uploadToStorage } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { adminInput } from "./ui";

type Props = {
  form: UseFormReturn<ProjectEditorValues>;
  projectId: string;
  /** Storage paths uploaded in this session that aren't saved yet (cleaned up on cancel). */
  unsavedPaths: React.RefObject<Set<string>>;
};

type UploadJob = { key: string; name: string; progress: number; error?: string };

const sourceOf = (m: { storagePath: string | null; externalUrl: string | null }) =>
  m.storagePath ?? m.externalUrl ?? "";

export function MediaManager({ form, projectId, unsavedPaths }: Props) {
  const { control, register, watch, setValue, getValues } = form;
  const { fields, append, remove, move } = useFieldArray({ control, name: "media" });
  const media = watch("media");
  const thumbnailPath = watch("thumbnailPath");

  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [urlDraft, setUrlDraft] = useState("");
  const [urlType, setUrlType] = useState<"image" | "gif" | "video">("image");
  const [urlError, setUrlError] = useState<string | null>(null);

  const updateJob = (key: string, patch: Partial<UploadJob>) =>
    setJobs((list) => list.map((j) => (j.key === key ? { ...j, ...patch } : j)));

  const getToken = async (): Promise<string | null> => {
    const { data } = await createBrowserSupabase().auth.getSession();
    return data.session?.access_token ?? null;
  };

  const discardUnsaved = async (paths: Array<string | null | undefined>) => {
    const toRemove = paths.filter((p): p is string => Boolean(p) && unsavedPaths.current.has(p as string));
    if (toRemove.length === 0) return;
    for (const p of toRemove) unsavedPaths.current.delete(p);
    await createBrowserSupabase().storage.from(MEDIA_BUCKET).remove(toRemove);
  };

  const uploadFiles = async (files: File[]) => {
    const token = await getToken();
    for (const file of files) {
      const key = crypto.randomUUID();
      const check = checkUpload(file);
      if (!check.ok) {
        setJobs((l) => [...l, { key, name: file.name, progress: 0, error: check.error }]);
        continue;
      }
      if (!token) {
        setJobs((l) => [
          ...l,
          { key, name: file.name, progress: 0, error: "Your session expired. Sign in again." },
        ]);
        continue;
      }

      const mediaId = crypto.randomUUID();
      const path = storagePathFor(projectId, check.ext, mediaId);
      setJobs((l) => [...l, { key, name: file.name, progress: 0 }]);
      try {
        await uploadToStorage({
          path,
          file,
          accessToken: token,
          onProgress: (p) => updateJob(key, { progress: p }),
        });
        unsavedPaths.current.add(path);
        append({
          mediaId,
          type: check.type,
          storagePath: path,
          externalUrl: null,
          alt: "",
          posterPath: null,
        });
        if (!getValues("thumbnailPath") && check.type !== "video") {
          setValue("thumbnailPath", path, { shouldDirty: true });
        }
        setJobs((l) => l.filter((j) => j.key !== key));
      } catch (err) {
        updateJob(key, {
          error: err instanceof Error ? err.message : "Upload failed.",
        });
      }
    }
  };

  const uploadPoster = async (index: number, file: File) => {
    const key = crypto.randomUUID();
    const check = checkUpload(file, { imagesOnly: true });
    if (!check.ok) {
      setJobs((l) => [...l, { key, name: file.name, progress: 0, error: check.error }]);
      return;
    }
    const token = await getToken();
    if (!token) {
      setJobs((l) => [
        ...l,
        { key, name: file.name, progress: 0, error: "Your session expired. Sign in again." },
      ]);
      return;
    }
    const path = storagePathFor(projectId, check.ext, crypto.randomUUID());
    setJobs((l) => [...l, { key, name: `Poster: ${file.name}`, progress: 0 }]);
    try {
      await uploadToStorage({
        path,
        file,
        accessToken: token,
        onProgress: (p) => updateJob(key, { progress: p }),
      });
      unsavedPaths.current.add(path);
      const previous = getValues(`media.${index}.posterPath`);
      setValue(`media.${index}.posterPath`, path, { shouldDirty: true });
      void discardUnsaved([previous]);
      setJobs((l) => l.filter((j) => j.key !== key));
    } catch (err) {
      updateJob(key, { error: err instanceof Error ? err.message : "Upload failed." });
    }
  };

  const removeItem = (index: number) => {
    const item = getValues(`media.${index}`);
    if (thumbnailPath && thumbnailPath === sourceOf(item)) {
      setValue("thumbnailPath", null, { shouldDirty: true });
    }
    remove(index);
    // Files that were never saved can go immediately; saved ones are removed when the project is saved.
    void discardUnsaved([item.storagePath, item.posterPath]);
  };

  const addByUrl = () => {
    const value = urlDraft.trim();
    if (!/^https:\/\//i.test(value) || value.length > 500) {
      setUrlError("Enter a full https:// URL.");
      return;
    }
    try {
      new URL(value);
    } catch {
      setUrlError("That doesn't look like a valid URL.");
      return;
    }
    append({
      mediaId: crypto.randomUUID(),
      type: urlType,
      storagePath: null,
      externalUrl: value,
      alt: "",
      posterPath: null,
    });
    setUrlDraft("");
    setUrlError(null);
  };

  const limits = `PNG, JPG, WebP up to ${formatBytes(MEDIA_RULES["image/png"].maxBytes)} · GIF up to ${formatBytes(MEDIA_RULES["image/gif"].maxBytes)} · MP4 up to ${formatBytes(MEDIA_RULES["video/mp4"].maxBytes)}`;

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void uploadFiles(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-card border border-dashed p-5 text-center transition-colors",
          dragging ? "border-accent bg-accent-soft" : "border-line-strong",
        )}
      >
        <Upload aria-hidden className="size-5 text-muted" />
        <p className="text-sm">
          Drag files here or{" "}
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="text-accent underline-offset-4 hover:underline"
          >
            browse
          </button>
        </p>
        <p className="text-xs text-subtle">{limits}</p>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          aria-label="Upload project media"
          onChange={(e) => {
            void uploadFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      {jobs.length > 0 && (
        <ul className="mt-3 space-y-2" aria-live="polite">
          {jobs.map((job) => (
            <li key={job.key} className="rounded-md border border-line p-2.5 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate">{job.name}</span>
                {job.error ? (
                  <button
                    type="button"
                    onClick={() => setJobs((l) => l.filter((j) => j.key !== job.key))}
                    className="text-muted underline-offset-4 hover:underline"
                  >
                    Dismiss
                  </button>
                ) : (
                  <span className="tabular-nums text-muted">{Math.round(job.progress * 100)}%</span>
                )}
              </div>
              {job.error ? (
                <p role="alert" className="mt-1 flex items-start gap-1.5 text-danger">
                  <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  {job.error}
                </p>
              ) : (
                <div
                  role="progressbar"
                  aria-valuenow={Math.round(job.progress * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Uploading ${job.name}`}
                  className="mt-2 h-1 overflow-hidden rounded-full bg-glass-strong"
                >
                  <div
                    className="h-full bg-accent transition-[width] duration-200"
                    style={{ width: `${job.progress * 100}%` }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {fields.length === 0 ? (
        <p className="mt-4 rounded-card border border-line p-4 text-center text-sm text-muted">
          No media uploaded yet.
        </p>
      ) : (
        <ol className="mt-4 space-y-2">
          {fields.map((field, index) => {
            const item = media[index];
            if (!item) return null;
            const src = resolveMediaUrl(sourceOf(item));
            const poster = resolveMediaUrl(item.posterPath);
            const isThumb = Boolean(thumbnailPath) && thumbnailPath === sourceOf(item);
            const canBeThumb = item.type !== "video";

            return (
              <li
                key={field.id}
                className="flex flex-col gap-3 rounded-card border border-line bg-surface/60 p-3 sm:flex-row"
              >
                <div className="relative h-[4.5rem] w-28 shrink-0 overflow-hidden rounded-md border border-line bg-elevated">
                  {item.type === "video" ? (
                    poster ? (
                      // eslint-disable-next-line @next/next/no-img-element -- admin preview
                      <img src={poster} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full flex-col items-center justify-center gap-1 text-subtle">
                        <Film aria-hidden className="size-5" />
                        <span className="text-[0.65rem]">Video</span>
                      </div>
                    )
                  ) : src ? (
                    // eslint-disable-next-line @next/next/no-img-element -- admin preview
                    <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                  ) : null}
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[0.6rem] uppercase">
                    {item.type}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {isThumb && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs">
                        <Star aria-hidden className="size-3 fill-accent text-accent" /> Thumbnail
                      </span>
                    )}
                    <span className="truncate text-xs text-subtle">
                      {item.externalUrl ? "External URL" : (item.storagePath ?? "").split("/").pop()}
                    </span>
                  </div>
                  <label className="mt-2 block text-xs text-muted" htmlFor={`alt-${field.id}`}>
                    Alt text
                  </label>
                  <input
                    id={`alt-${field.id}`}
                    type="text"
                    maxLength={300}
                    placeholder="Describe what's shown (for screen readers)"
                    className={cn(adminInput, "mt-1 h-9")}
                    {...register(`media.${index}.alt`)}
                  />

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      className={miniButton}
                      disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                      aria-label={`Move media ${index + 1} up`}
                    >
                      <ArrowUp aria-hidden className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className={miniButton}
                      disabled={index === fields.length - 1}
                      onClick={() => move(index, index + 1)}
                      aria-label={`Move media ${index + 1} down`}
                    >
                      <ArrowDown aria-hidden className="size-3.5" />
                    </button>

                    {canBeThumb && (
                      <button
                        type="button"
                        className={miniButton}
                        disabled={isThumb}
                        onClick={() =>
                          setValue("thumbnailPath", sourceOf(item), { shouldDirty: true })
                        }
                      >
                        <Star aria-hidden className="size-3.5" />
                        {isThumb ? "Is thumbnail" : "Use as thumbnail"}
                      </button>
                    )}

                    {item.type === "video" && (
                      <>
                        <label className={cn(miniButton, "cursor-pointer")}>
                          <ImagePlus aria-hidden className="size-3.5" />
                          {item.posterPath ? "Replace poster" : "Add poster"}
                          <input
                            type="file"
                            accept={POSTER_ACCEPT_ATTRIBUTE}
                            className="sr-only"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void uploadPoster(index, file);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        {item.posterPath && (
                          <button
                            type="button"
                            className={miniButton}
                            onClick={() => {
                              const previous = item.posterPath;
                              setValue(`media.${index}.posterPath`, null, { shouldDirty: true });
                              void discardUnsaved([previous]);
                            }}
                          >
                            Remove poster
                          </button>
                        )}
                      </>
                    )}

                    <button
                      type="button"
                      className={cn(miniButton, "ml-auto hover:border-danger/50 hover:text-danger")}
                      onClick={() => removeItem(index)}
                    >
                      <Trash2 aria-hidden className="size-3.5" />
                      Remove
                    </button>
                  </div>
                  {form.formState.errors.media?.[index]?.alt && (
                    <p role="alert" className="mt-1 text-xs text-danger">
                      {form.formState.errors.media[index]?.alt?.message}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-4 rounded-card border border-line p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
          <Link2 aria-hidden className="size-3.5" /> Or add media by URL
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            type="url"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addByUrl();
              }
            }}
            placeholder="https://…"
            aria-label="Media URL"
            aria-invalid={Boolean(urlError)}
            className={cn(adminInput, "h-9 min-w-48 flex-1")}
          />
          <select
            value={urlType}
            onChange={(e) => setUrlType(e.target.value as typeof urlType)}
            aria-label="Media type"
            className={cn(adminInput, "h-9 w-auto")}
          >
            <option value="image">Image</option>
            <option value="gif">GIF</option>
            <option value="video">Video</option>
          </select>
          <button type="button" onClick={addByUrl} className={cn(miniButton, "h-9 px-3")}>
            Add
          </button>
        </div>
        {urlError && (
          <p role="alert" className="mt-1.5 text-xs text-danger">
            {urlError}
          </p>
        )}
      </div>
    </div>
  );
}

const miniButton =
  "inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-muted transition-colors " +
  "hover:border-line-strong hover:bg-glass-strong hover:text-ink disabled:pointer-events-none disabled:opacity-40";
