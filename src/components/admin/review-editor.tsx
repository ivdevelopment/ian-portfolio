"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { saveReviewAction } from "@/app/admin/(panel)/reviews/actions";
import { AVATAR_MAX_BYTES, reviewAvatarPath } from "@/lib/media-rules";
import {
  REVIEW_STATUSES,
  REVIEW_STATUS_LABELS,
  reviewEditorSchema,
  type ReviewEditorValues,
} from "@/lib/schemas/review";
import { cn } from "@/lib/utils";
import { RatingInput } from "@/components/forms/rating-input";
import { Field, SaveBar, errorAt, useSaveForm } from "./form-bits";
import { ImageField } from "./image-field";
import { Panel, adminInput } from "./ui";

type Props = {
  initial: ReviewEditorValues;
  mode: "create" | "edit";
  /** Present for invitation reviews: the client's words exactly as submitted. */
  originalText?: string | null;
  source: "admin" | "invitation";
  projects: Array<{ id: string; title: string }>;
};

export function ReviewEditor({ initial, mode, originalText, source, projects }: Props) {
  const router = useRouter();
  const form = useForm<ReviewEditorValues>({
    resolver: zodResolver(reviewEditorSchema),
    defaultValues: initial,
    mode: "onTouched",
  });
  const { register, control, formState } = form;
  const [created, setCreated] = useState(false);
  const publishedText = useWatch({ control, name: "reviewText" });

  const { status, submit } = useSaveForm(form, async (values) => {
    const result = await saveReviewAction(values);
    if (result.ok && mode === "create") {
      setCreated(true);
      router.replace(`/admin/reviews/${values.id}/edit`);
    }
    return result;
  });

  const err = (path: string) => errorAt(formState.errors, path);
  const originalDiffers = originalText != null && originalText !== publishedText;

  return (
    <form onSubmit={(e) => e.preventDefault()} noValidate className="grid items-start gap-4 lg:grid-cols-[1fr_19rem]">
      <div className="space-y-4">
        <Panel title="Reviewer">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="name" label="Name" error={err("name")} className="sm:col-span-2">
              <input id="name" type="text" maxLength={120} aria-invalid={Boolean(err("name"))} aria-describedby={err("name") ? "name-error" : undefined} className={cn(adminInput, "h-10")} {...register("name")} />
            </Field>
            <Field id="company" label="Company (optional)" error={err("company")}>
              <input id="company" type="text" maxLength={120} className={cn(adminInput, "h-10")} {...register("company")} />
            </Field>
            <Field id="role" label="Role (optional)" error={err("role")}>
              <input id="role" type="text" maxLength={120} className={cn(adminInput, "h-10")} {...register("role")} />
            </Field>
            <div className="sm:col-span-2">
              <Controller
                control={control}
                name="avatarPath"
                render={({ field }) => (
                  <ImageField
                    label="Avatar (optional)"
                    round
                    value={field.value}
                    onChange={field.onChange}
                    buildPath={(ext, id) => reviewAvatarPath(initial.id, ext, id)}
                    maxBytes={AVATAR_MAX_BYTES}
                    error={err("avatarPath")}
                  />
                )}
              />
              <p className="mt-1 text-xs text-subtle">Without an avatar, initials are shown.</p>
            </div>
          </div>
        </Panel>

        <Panel title="Review">
          <div className="space-y-4">
            <Controller
              control={control}
              name="rating"
              render={({ field }) => (
                <RatingInput value={field.value} onChange={field.onChange} error={err("rating")} errorId="rating-error" />
              )}
            />

            {originalText != null && (
              <div className="rounded-md border border-line p-3">
                <p className="text-xs font-medium text-muted">Original submission</p>
                <p className="mt-1 text-sm whitespace-pre-wrap">{originalText}</p>
                <p className="mt-2 text-xs text-subtle">
                  Read-only. This is the client&apos;s original text and is kept even if you edit the published text.
                </p>
              </div>
            )}

            <Field
              id="reviewText"
              label="Published text"
              error={err("reviewText")}
              hint={
                originalDiffers
                  ? "This text differs from the original submission."
                  : "Plain text. This is what visitors see."
              }
            >
              <textarea
                id="reviewText"
                rows={7}
                maxLength={4000}
                aria-invalid={Boolean(err("reviewText"))}
                aria-describedby={err("reviewText") ? "reviewText-error" : undefined}
                className={cn(adminInput, "py-2")}
                {...register("reviewText")}
              />
            </Field>
          </div>
        </Panel>

        <Panel title="Project">
          <Field id="projectId" label="Related project (optional)" hint="Shown as “Client feedback” on that project's page.">
            <select id="projectId" className={cn(adminInput, "h-10")} {...register("projectId")}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </Field>
        </Panel>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4">
        <Panel title="Publishing">
          <p className="text-xs text-subtle">
            Source: {source === "invitation" ? "Submitted via invitation link" : "Added by admin"}
          </p>
          <div className="mt-4 space-y-4">
            <Field id="status" label="Status">
              <select id="status" className={cn(adminInput, "h-10")} {...register("status")}>
                {REVIEW_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {REVIEW_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent-strong)]" {...register("featured")} />
              <span>
                Featured
                <span className="block text-xs text-subtle">Shown first on the homepage.</span>
              </span>
            </label>
            <Field id="sortOrder" label="Sort order" error={err("sortOrder")} hint="Lower numbers come first.">
              <input id="sortOrder" type="number" min={0} max={9999} className={cn(adminInput, "h-9")} {...register("sortOrder", { valueAsNumber: true })} />
            </Field>
          </div>
          <Link href="/admin/reviews" className="mt-4 inline-block text-sm text-muted hover:text-ink">
            Back to reviews
          </Link>
        </Panel>
      </aside>

      <div className="lg:col-span-2">
        <SaveBar
          status={created ? { kind: "saving" } : status}
          dirty={formState.isDirty}
          label={mode === "create" ? "Create review" : "Save review"}
          onSave={() => void submit()}
        />
      </div>
    </form>
  );
}
