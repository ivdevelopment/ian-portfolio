"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Eye,
  Plus,
  Trash2,
} from "lucide-react";
import {
  deleteProjectAction,
  saveProjectAction,
} from "@/app/(admin)/admin/(panel)/projects/actions";
import { MEDIA_BUCKET } from "@/lib/supabase/env";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { AdminSelect } from "./admin-select";
import { slugify } from "@/lib/slug";
import {
  KIND_LABELS,
  PROJECT_KINDS,
  PROJECT_TYPE_LABELS,
  PROJECT_TYPE_VALUES,
  projectEditorSchema,
  type ProjectEditorValues,
} from "@/lib/schemas/project";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "./confirm-dialog";
import { MediaManager } from "./media-manager";
import { TagInput } from "./tag-input";
import { Panel, adminInput } from "./ui";

type Props = {
  mode: "create" | "edit";
  initial: ProjectEditorValues;
  notice?: "created" | "duplicated";
};

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; warning?: string }
  | { kind: "error"; message: string };

const PREVIEW_OPTIONS = [
  {
    value: "media",
    label: "Media",
    help: "Show the project's screenshots, GIFs and videos. Works for every project.",
  },
  {
    value: "embed",
    label: "Embed",
    help: "Show the live site inside the page. Many sites block this, so visitors also get an “open in new tab” fallback.",
  },
  {
    value: "external",
    label: "External",
    help: "Link out to the live site in a new tab. Best for sites that can't be embedded.",
  },
] as const;

function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-subtle">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function ProjectEditor({ mode, initial, notice }: Props) {
  const router = useRouter();
  const form = useForm<ProjectEditorValues>({
    resolver: zodResolver(projectEditorSchema),
    defaultValues: initial,
    mode: "onTouched",
  });
  const {
    register,
    control,
    setValue,
    setError,
    handleSubmit,
    formState: { errors },
  } = form;

  const [status, setStatus] = useState<Status>(
    notice
      ? {
          kind: "saved",
          warning:
            notice === "duplicated"
              ? "Duplicated as a draft. Review the details, then publish when ready."
              : undefined,
        }
      : { kind: "idle" },
  );
  // The one-off "Project created" note disappears after the first save in this session.
  const [savedSince, setSavedSince] = useState(false);
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [slugUnlocked, setSlugUnlocked] = useState(mode === "create");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const unsavedPaths = useRef<Set<string>>(new Set());

  const features = useFieldArray({ control, name: "features" });
  const previewMode = useWatch({ control, name: "previewMode" });
  const published = useWatch({ control, name: "published" });
  const slugValue = useWatch({ control, name: "slug" });
  const wasPublished = initial.published;
  // Reliable react-hook-form dirty state: clean again when values return to the saved ones.
  const isDirty = form.formState.isDirty;

  // Warn before a refresh / tab close would discard unsaved edits.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);
  const saving = status.kind === "saving";

  const applyServerErrors = (fieldErrors?: Record<string, string>) => {
    if (!fieldErrors) return;
    for (const [key, message] of Object.entries(fieldErrors)) {
      setError(key as FieldPath<ProjectEditorValues>, { message });
    }
  };

  const save = async (publish: boolean) => {
    setValue("published", publish);
    await handleSubmit(
      async (values) => {
        setStatus({ kind: "saving" });
        const result = await saveProjectAction(values);
        if (!result.ok) {
          applyServerErrors(result.fieldErrors);
          setStatus({ kind: "error", message: result.error });
          return;
        }
        unsavedPaths.current.clear();
        if (mode === "create") {
          router.replace(`/admin/projects/${values.id}/edit?created=1`);
          return;
        }
        form.reset(values);
        setSlugUnlocked(false);
        setSavedSince(true);
        setStatus({ kind: "saved", warning: result.warning });
        router.refresh();
      },
      () => setStatus({ kind: "error", message: "Please fix the highlighted fields." }),
    )();
  };

  const discardUploads = async () => {
    const paths = [...unsavedPaths.current];
    unsavedPaths.current.clear();
    if (paths.length > 0) {
      await createBrowserSupabase().storage.from(MEDIA_BUCKET).remove(paths);
    }
  };

  const err = (key: FieldPath<ProjectEditorValues>) => {
    const parts = key.split(".");
    let node: unknown = errors;
    for (const part of parts) node = (node as Record<string, unknown> | undefined)?.[part];
    return (node as { message?: string } | undefined)?.message;
  };

  const titleField = register("title", {
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!slugTouched) setValue("slug", slugify(e.target.value), { shouldValidate: false });
    },
  });

  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      noValidate
      className="grid items-start gap-4 lg:grid-cols-[1fr_19rem]"
    >
      <div className="space-y-4">
        {status.kind === "error" && (
          <div role="alert" className="flex gap-2 rounded-card border border-danger/40 p-3 text-sm">
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
            {status.message}
          </div>
        )}
        {status.kind === "saved" && status.warning && (
          <div
            role="status"
            className="flex gap-2 rounded-card border border-accent/40 bg-accent-soft p-3 text-sm"
          >
            <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
            <p>{status.warning}</p>
          </div>
        )}
        {notice === "created" && !savedSince && status.kind === "saved" && !status.warning && (
          <div role="status" className="flex gap-2 rounded-card border border-accent/40 bg-accent-soft p-3 text-sm">
            <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
            Project created.
          </div>
        )}

        <Panel title="Basic information">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="title" label="Title" error={err("title")} className="sm:col-span-2">
              <input
                id="title"
                type="text"
                maxLength={120}
                aria-invalid={Boolean(errors.title)}
                aria-describedby={errors.title ? "title-error" : undefined}
                className={cn(adminInput, "h-10")}
                {...titleField}
              />
            </Field>

            <Field
              id="slug"
              label="Slug"
              error={err("slug")}
              hint={`Public URL: /work/${slugValue || "your-slug"}`}
              className="sm:col-span-2"
            >
              <div className="flex gap-2">
                <input
                  id="slug"
                  type="text"
                  maxLength={80}
                  readOnly={!slugUnlocked}
                  aria-invalid={Boolean(errors.slug)}
                  aria-describedby={errors.slug ? "slug-error" : undefined}
                  className={cn(adminInput, "h-10 font-mono", !slugUnlocked && "opacity-70")}
                  {...register("slug", { onChange: () => setSlugTouched(true) })}
                />
                {!slugUnlocked && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-10"
                    onClick={() => setSlugUnlocked(true)}
                  >
                    Change
                  </Button>
                )}
              </div>
              {mode === "edit" && slugUnlocked && (
                <p className="mt-1.5 text-xs text-amber-200">
                  Changing the slug changes this project&apos;s URL — existing links to the old
                  address will stop working.
                </p>
              )}
            </Field>

            <Field id="subtitle" label="Subtitle" error={err("subtitle")} className="sm:col-span-2">
              <input
                id="subtitle"
                type="text"
                maxLength={160}
                className={cn(adminInput, "h-10")}
                {...register("subtitle")}
              />
            </Field>

            <Field
              id="shortDescription"
              label="Short description"
              error={err("shortDescription")}
              hint="Shown on cards and in search results."
              className="sm:col-span-2"
            >
              <textarea
                id="shortDescription"
                rows={2}
                maxLength={400}
                aria-invalid={Boolean(errors.shortDescription)}
                className={cn(adminInput, "py-2")}
                {...register("shortDescription")}
              />
            </Field>

            <Field
              id="description"
              label="Long description"
              error={err("description")}
              hint="Plain text. Line breaks are not formatted."
              className="sm:col-span-2"
            >
              <textarea
                id="description"
                rows={5}
                maxLength={8000}
                className={cn(adminInput, "py-2")}
                {...register("description")}
              />
            </Field>

            <Field id="category" label="Category" error={err("category")} hint="e.g. Creative Audio Software">
              <input
                id="category"
                type="text"
                maxLength={80}
                aria-invalid={Boolean(errors.category)}
                className={cn(adminInput, "h-10")}
                {...register("category")}
              />
            </Field>

            <Field id="kind" label="Type of work" hint="Used by the public filters.">
              <Controller
                control={control}
                name="kind"
                render={({ field }) => (
                  <AdminSelect
                    id="kind"
                    value={field.value}
                    onChange={field.onChange}
                    options={PROJECT_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
                  />
                )}
              />
            </Field>

            <Field id="year" label="Year" error={err("year")}>
              <input
                id="year"
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="2026"
                aria-invalid={Boolean(errors.year)}
                className={cn(adminInput, "h-10")}
                {...register("year")}
              />
            </Field>

            <Field id="client" label="Client" error={err("client")}>
              <input id="client" type="text" maxLength={120} className={cn(adminInput, "h-10")} {...register("client")} />
            </Field>

            <Field
              id="projectType"
              label="Project type"
              hint="Be accurate: label concepts and personal work as such."
              className="sm:col-span-2"
            >
              <Controller
                control={control}
                name="projectType"
                render={({ field }) => (
                  <AdminSelect
                    id="projectType"
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    options={[
                      { value: "", label: "Not specified" },
                      ...PROJECT_TYPE_VALUES.map((t) => ({ value: t, label: PROJECT_TYPE_LABELS[t] })),
                    ]}
                  />
                )}
              />
            </Field>
          </div>
        </Panel>

        <Panel title="URLs">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="liveUrl" label="Live URL" error={err("liveUrl")} className="sm:col-span-2">
              <input
                id="liveUrl"
                type="url"
                placeholder="https://"
                aria-invalid={Boolean(errors.liveUrl)}
                className={cn(adminInput, "h-10")}
                {...register("liveUrl")}
              />
            </Field>
            <Field
              id="previewUrl"
              label="Preview URL"
              error={err("previewUrl")}
              hint="Optional. Used for the embed; falls back to the live URL."
            >
              <input
                id="previewUrl"
                type="url"
                placeholder="https://"
                aria-invalid={Boolean(errors.previewUrl)}
                className={cn(adminInput, "h-10")}
                {...register("previewUrl")}
              />
            </Field>
            <Field id="githubUrl" label="GitHub URL" error={err("githubUrl")}>
              <input
                id="githubUrl"
                type="url"
                placeholder="https://github.com/…"
                aria-invalid={Boolean(errors.githubUrl)}
                className={cn(adminInput, "h-10")}
                {...register("githubUrl")}
              />
            </Field>
          </div>
        </Panel>

        <Panel title="Live preview" description="How visitors can preview this project.">
          <fieldset>
            <legend className="sr-only">Preview mode</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {PREVIEW_OPTIONS.map((option) => (
                <label key={option.value} className="cursor-pointer">
                  <input
                    type="radio"
                    value={option.value}
                    className="peer sr-only"
                    {...register("previewMode")}
                  />
                  <span
                    className={cn(
                      "block h-full rounded-card border border-line p-3 transition-colors",
                      "hover:border-line-strong peer-checked:border-accent/60 peer-checked:bg-accent-soft",
                      "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent",
                    )}
                  >
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="mt-1 block text-xs text-muted">{option.help}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {previewMode !== "media" && (
            <p className="mt-2 text-xs text-subtle">
              {previewMode === "embed"
                ? "Needs a preview URL or live URL (set above)."
                : "Needs a live URL (set above)."}
            </p>
          )}
        </Panel>

        <Panel title="Tags & technologies">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="tags" label="Tags" error={err("tags")} hint="Press Enter or comma to add. e.g. Web Design">
              <Controller
                control={control}
                name="tags"
                render={({ field }) => (
                  <TagInput
                    id="tags"
                    value={field.value}
                    onChange={field.onChange}
                    max={12}
                    placeholder="Add a tag"
                    invalid={Boolean(errors.tags)}
                  />
                )}
              />
            </Field>
            <Field id="technologies" label="Technologies" error={err("technologies")} hint="e.g. Next.js">
              <Controller
                control={control}
                name="technologies"
                render={({ field }) => (
                  <TagInput
                    id="technologies"
                    value={field.value}
                    onChange={field.onChange}
                    max={16}
                    placeholder="Add a technology"
                    invalid={Boolean(errors.technologies)}
                  />
                )}
              />
            </Field>
          </div>
        </Panel>

        <Panel title="Key features" description="Shown as a checklist on the project page.">
          {features.fields.length === 0 && (
            <p className="mb-3 text-sm text-muted">No features added yet.</p>
          )}
          <ul className="space-y-2">
            {features.fields.map((field, index) => (
              <li key={field.id} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <input
                    type="text"
                    maxLength={160}
                    aria-label={`Feature ${index + 1}`}
                    aria-invalid={Boolean(errors.features?.[index]?.label)}
                    className={cn(adminInput, "h-9")}
                    {...register(`features.${index}.label`)}
                  />
                  {errors.features?.[index]?.label && (
                    <p role="alert" className="mt-1 text-xs text-danger">
                      {errors.features[index]?.label?.message}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className={iconBtn}
                  disabled={index === 0}
                  onClick={() => features.move(index, index - 1)}
                  aria-label={`Move feature ${index + 1} up`}
                >
                  <ArrowUp aria-hidden className="size-3.5" />
                </button>
                <button
                  type="button"
                  className={iconBtn}
                  disabled={index === features.fields.length - 1}
                  onClick={() => features.move(index, index + 1)}
                  aria-label={`Move feature ${index + 1} down`}
                >
                  <ArrowDown aria-hidden className="size-3.5" />
                </button>
                <button
                  type="button"
                  className={cn(iconBtn, "hover:border-danger/50 hover:text-danger")}
                  onClick={() => features.remove(index)}
                  aria-label={`Remove feature ${index + 1}`}
                >
                  <Trash2 aria-hidden className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            onClick={() => features.append({ label: "" })}
            disabled={features.fields.length >= 20}
          >
            <Plus aria-hidden className="size-4" /> Add feature
          </Button>
        </Panel>

        <Panel
          title="Media"
          description="Images, GIFs and MP4 videos. The first item is shown first; one image is used as the thumbnail."
        >
          <MediaManager form={form} projectId={initial.id} unsavedPaths={unsavedPaths} />
          {errors.media?.message && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {errors.media.message}
            </p>
          )}
        </Panel>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4">
        <Panel title="Publishing">
          <p className="text-sm">
            Status:{" "}
            <span className={cn("font-medium", wasPublished ? "text-emerald-200" : "text-muted")}>
              {wasPublished ? "Published" : "Draft"}
            </span>
          </p>

          <div className="mt-4 space-y-3">
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--color-accent-strong)]"
                {...register("featured")}
              />
              <span>
                Featured
                <span className="block text-xs text-subtle">Appears in the homepage carousel.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--color-accent-strong)]"
                {...register("isExample")}
              />
              <span>
                Sample project
                <span className="block text-xs text-subtle">
                  Labels the page as placeholder content.
                </span>
              </span>
            </label>
            <Field id="sortOrder" label="Sort order" error={err("sortOrder")} hint="Lower numbers come first.">
              <input
                id="sortOrder"
                type="number"
                min={0}
                max={9999}
                className={cn(adminInput, "h-9")}
                {...register("sortOrder", { valueAsNumber: true })}
              />
            </Field>
          </div>

          <div className="mt-5 flex flex-col gap-2">
            {wasPublished ? (
              <>
                <Button onClick={() => save(true)} disabled={saving || !isDirty} pending={saving && published} pendingLabel="Saving…">
                  Save changes
                </Button>
                <Button variant="secondary" onClick={() => save(false)} disabled={saving} pending={saving && !published} pendingLabel="Moving to draft…">
                  Move to draft
                </Button>
              </>
            ) : (
              <>
                <Button onClick={() => save(true)} disabled={saving} pending={saving && published} pendingLabel="Publishing…">
                  Publish
                </Button>
                <Button variant="secondary" onClick={() => save(false)} disabled={saving} pending={saving && !published} pendingLabel="Saving draft…">
                  Save draft
                </Button>
              </>
            )}
            <Link
              href="/admin/projects"
              onClick={() => void discardUploads()}
              className="inline-flex h-10 items-center justify-center rounded-full text-sm text-muted transition-colors hover:text-ink"
            >
              Cancel
            </Link>
          </div>
        </Panel>

        {mode === "edit" && (
          <Panel title="More">
            <div className="flex flex-col gap-2 text-sm">
              <Link
                href={`/admin/projects/${initial.id}/preview`}
                className="inline-flex items-center gap-2 text-muted hover:text-ink"
              >
                <Eye aria-hidden className="size-4" /> Preview last saved version
              </Link>
              <button
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteOpen(true);
                }}
                className="inline-flex items-center gap-2 text-left text-danger hover:underline"
              >
                <Trash2 aria-hidden className="size-4" /> Delete project
              </button>
            </div>
          </Panel>
        )}
      </aside>

      <ConfirmDialog
        open={deleteOpen}
        title={`Delete “${initial.title}”?`}
        confirmLabel="Delete project"
        pending={deleting}
        error={deleteError}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          setDeleting(true);
          setDeleteError(null);
          const result = await deleteProjectAction(initial.id);
          setDeleting(false);
          if (!result.ok) {
            setDeleteError(result.error);
            return;
          }
          router.replace("/admin/projects");
        }}
      >
        <p>
          This permanently deletes <strong className="text-ink">{initial.title}</strong>, its
          features and its uploaded media. It will disappear from the public site. This can&apos;t
          be undone.
        </p>
      </ConfirmDialog>
    </form>
  );
}

const iconBtn =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-line text-muted transition-colors " +
  "hover:border-line-strong hover:bg-glass-strong hover:text-ink disabled:pointer-events-none disabled:opacity-40";
