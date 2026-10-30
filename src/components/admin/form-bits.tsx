"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useState } from "react";
import type { FieldErrors, FieldPath, FieldValues, UseFormReturn } from "react-hook-form";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Set while editing a translation (e.g. Dutch). Text fields stay editable;
 * "shared" fields (links, images, numbers, email) are shown read-only because
 * they are taken from the English/base content for every language.
 */
const TranslatingContext = createContext(false);
export const TranslatingProvider = TranslatingContext.Provider;
export const useTranslating = () => useContext(TranslatingContext);

export const SHARED_HINT = "Shared by every language — change it on the English tab.";

export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string; warning?: string }
  | { kind: "error"; message: string };

export type SaveResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Message for a (possibly nested) field path such as `hero.primaryCta.href`. */
export function errorAt<T extends FieldValues>(errors: FieldErrors<T>, path: string): string | undefined {
  let node: unknown = errors;
  for (const part of path.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
  const message = (node as { message?: unknown } | undefined)?.message;
  return typeof message === "string" ? message : undefined;
}

/**
 * Wires a react-hook-form form to a server action: validates (resolver), saves,
 * maps server-side field errors back onto the fields, and reports status.
 */
export function useSaveForm<T extends FieldValues>(
  form: UseFormReturn<T>,
  action: (values: T) => Promise<SaveResult>,
) {
  const router = useRouter();
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });

  const submit = form.handleSubmit(
    async (values) => {
      setStatus({ kind: "saving" });
      const result = await action(values);
      if (!result.ok) {
        for (const [key, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(key as FieldPath<T>, { message });
        }
        setStatus({ kind: "error", message: result.error });
        return;
      }
      form.reset(values);
      setStatus({
        kind: "saved",
        warning: result.warning,
        at: new Intl.DateTimeFormat("en-GB", { timeStyle: "short" }).format(new Date()),
      });
      router.refresh();
    },
    () => setStatus({ kind: "error", message: "Please fix the highlighted fields." }),
  );

  return { status, submit };
}

export function Field({
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

/** Sticky save bar: primary action, plus an announced status (never colour-only). */
export function SaveBar({
  status,
  dirty,
  label = "Save changes",
  onSave,
}: {
  status: SaveStatus;
  dirty?: boolean;
  label?: string;
  onSave: () => void;
}) {
  const saving = status.kind === "saving";
  return (
    <div className="glass-strong sticky bottom-3 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card px-4 py-3">
      <div aria-live="polite" className="min-h-5 text-sm">
        {status.kind === "error" && (
          <span role="alert" className="inline-flex items-center gap-2 text-danger">
            <AlertCircle aria-hidden className="size-4" />
            {status.message}
          </span>
        )}
        {status.kind === "saved" && (
          <span role="status" className="inline-flex items-center gap-2 text-muted">
            <CheckCircle2 aria-hidden className="size-4 text-accent" />
            Saved at {status.at}.{status.warning ? ` ${status.warning}` : ""}
          </span>
        )}
        {status.kind === "idle" && dirty && <span className="text-muted">Unsaved changes</span>}
      </div>
      <Button onClick={onSave} disabled={saving} size="sm">
        {saving && <Loader2 aria-hidden className="size-4 animate-spin" />}
        {saving ? "Saving…" : label}
      </Button>
    </div>
  );
}

export const textareaClass = "py-2";
export const rowButton = cn(
  "inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-line text-muted transition-colors",
  "hover:border-line-strong hover:bg-glass-strong hover:text-ink disabled:pointer-events-none disabled:opacity-40",
);

/* ---- helpers for forms wrapped in <FormProvider> ---- */

import { useFieldArray, useFormContext } from "react-hook-form";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { adminInput } from "./ui";

export function TextField({
  name,
  label,
  hint,
  multiline,
  rows = 3,
  maxLength,
  className,
  type = "text",
  placeholder,
  shared,
}: {
  /** Shared between languages: read-only while translating. */
  shared?: boolean;
  name: string;
  label: string;
  hint?: string;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  className?: string;
  type?: string;
  placeholder?: string;
}) {
  const { register, formState } = useFormContext();
  const translating = useTranslating();
  const locked = Boolean(shared && translating);
  const id = name.replace(/\./g, "-");
  const error = errorAt(formState.errors, name);
  const common = {
    id,
    maxLength,
    placeholder,
    readOnly: locked,
    tabIndex: locked ? -1 : undefined,
    "aria-invalid": Boolean(error),
    "aria-describedby": error ? `${id}-error` : undefined,
    ...register(name),
  };
  return (
    <Field id={id} label={label} hint={locked ? SHARED_HINT : hint} error={error} className={className}>
      {multiline ? (
        <textarea rows={rows} className={cn(adminInput, "py-2", locked && "opacity-60")} {...common} />
      ) : (
        <input type={type} className={cn(adminInput, "h-10", locked && "opacity-60")} {...common} />
      )}
    </Field>
  );
}

/** Ordered list of {value, label, enabled} stats (array position = sort order). */
export function StatsFields({ name }: { name: string }) {
  const { control, register, formState } = useFormContext();
  const translating = useTranslating();
  const { fields, append, remove, move } = useFieldArray({ control, name });

  return (
    <div>
      {fields.length === 0 && <p className="mb-3 text-sm text-muted">No stats yet.</p>}
      <ul className="space-y-3">
        {fields.map((field, i) => {
          const valueError = errorAt(formState.errors, `${name}.${i}.value`);
          const labelError = errorAt(formState.errors, `${name}.${i}.label`);
          return (
            <li key={field.id} className="rounded-card border border-line p-3">
              <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                <div>
                  <label htmlFor={`${name}-${i}-value`} className="mb-1.5 block text-xs font-medium text-muted">Value</label>
                  <input id={`${name}-${i}-value`} maxLength={20} placeholder="12+" aria-invalid={Boolean(valueError)} readOnly={translating} className={cn(adminInput, "h-9", translating && "opacity-60")} {...register(`${name}.${i}.value`)} />
                  {valueError && <p role="alert" className="mt-1 text-xs text-danger">{valueError}</p>}
                </div>
                <div>
                  <label htmlFor={`${name}-${i}-label`} className="mb-1.5 block text-xs font-medium text-muted">Label</label>
                  <input id={`${name}-${i}-label`} maxLength={60} placeholder="Projects completed" aria-invalid={Boolean(labelError)} className={cn(adminInput, "h-9")} {...register(`${name}.${i}.label`)} />
                  {labelError && <p role="alert" className="mt-1 text-xs text-danger">{labelError}</p>}
                </div>
              </div>
              {!translating && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="mr-auto flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-[var(--color-accent-strong)]" {...register(`${name}.${i}.enabled`)} />
                  Enabled
                </label>
                <button type="button" className={rowButton} disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Move stat ${i + 1} up`}>
                  <ArrowUp aria-hidden className="size-3.5" />
                </button>
                <button type="button" className={rowButton} disabled={i === fields.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move stat ${i + 1} down`}>
                  <ArrowDown aria-hidden className="size-3.5" />
                </button>
                <button type="button" className={cn(rowButton, "hover:border-danger/50 hover:text-danger")} onClick={() => remove(i)} aria-label={`Remove stat ${i + 1}`}>
                  <Trash2 aria-hidden className="size-3.5" />
                </button>
              </div>
              )}
            </li>
          );
        })}
      </ul>
      {!translating && (
        <Button size="sm" variant="secondary" className="mt-3" disabled={fields.length >= 6} onClick={() => append({ value: "", label: "", enabled: true })}>
          <Plus aria-hidden className="size-4" /> Add stat
        </Button>
      )}
    </div>
  );
}
