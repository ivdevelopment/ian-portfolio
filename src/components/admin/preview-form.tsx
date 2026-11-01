"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { createPreviewAction, updatePreviewAction } from "@/app/(admin)/admin/(panel)/previews/actions";
import { Button } from "@/components/ui/button";
import { generateAccessCode } from "@/lib/preview/access-code";
import type { ExpiryInput } from "@/lib/preview/expiry";
import {
  DEFAULT_SESSION_HOURS,
  previewCreateSchema,
  previewDetailsSchema,
  type PreviewDetailsValues,
} from "@/lib/schemas/preview";
import { AdminSelect } from "./admin-select";
import { Field, SaveBar } from "./form-bits";
import { PreviewSecretDialog } from "./preview-secret-dialog";
import { Panel, adminInput } from "./ui";
import { useDirtySaveState } from "./use-dirty-save";
import { cn } from "@/lib/utils";

export type PreviewFormValues = {
  clientName: string;
  projectName: string;
  subdomain: string;
  targetUrl: string;
  expiryChoice: "keep" | "never" | "7" | "14" | "30" | "custom";
  expiryDate: string;
  sessionTtlHours: 24 | 168 | 336;
  notes: string;
  code: string;
};

const EXPIRY_OPTIONS = [
  { value: "never", label: "Never" },
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "custom", label: "Custom date…" },
];
const SESSION_OPTIONS = [
  { value: "24", label: "24 hours" },
  { value: "168", label: "7 days" },
  { value: "336", label: "14 days" },
];

export const emptyPreviewForm: PreviewFormValues = {
  clientName: "",
  projectName: "",
  subdomain: "",
  targetUrl: "",
  expiryChoice: "never",
  expiryDate: "",
  sessionTtlHours: DEFAULT_SESSION_HOURS,
  notes: "",
  code: "",
};

function expiryInput(v: PreviewFormValues): ExpiryInput {
  if (v.expiryChoice === "keep") return { kind: "keep" };
  if (v.expiryChoice === "never") return { kind: "never" };
  if (v.expiryChoice === "custom") return { kind: "date", date: v.expiryDate };
  return { kind: "days", days: Number(v.expiryChoice) as 7 | 14 | 30 };
}

function toPayload(v: PreviewFormValues): PreviewDetailsValues & { code?: string } {
  return {
    clientName: v.clientName,
    projectName: v.projectName,
    subdomain: v.subdomain,
    targetUrl: v.targetUrl,
    expiry: expiryInput(v),
    sessionTtlHours: v.sessionTtlHours,
    notes: v.notes,
  };
}

/** Client-side check with the same schema the server uses; returns { "<path>": message }. */
function validate(v: PreviewFormValues, withCode: boolean): Record<string, string> {
  const result = withCode
    ? previewCreateSchema.safeParse({ ...toPayload(v), code: v.code })
    : previewDetailsSchema.safeParse(toPayload(v));
  const errors: Record<string, string> = {};
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path.join(".");
      if (key && !errors[key]) errors[key] = issue.message;
    }
  }
  return errors;
}

export function PreviewForm({
  mode,
  baseDomain,
  id,
  initial = emptyPreviewForm,
  currentExpiryLabel,
}: {
  mode: "create" | "edit";
  baseDomain: string;
  id?: string;
  initial?: PreviewFormValues;
  /** Edit only: shown next to "Keep current". */
  currentExpiryLabel?: string;
}) {
  const router = useRouter();
  const creating = mode === "create";
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ url: string; code: string } | null>(null);
  const [creatingNow, setCreatingNow] = useState(false);

  const { value, setValue, dirty, status, save } = useDirtySaveState<PreviewFormValues>(
    initial,
    async (draft) => {
      const found = validate(draft, false);
      setErrors(found);
      if (Object.keys(found).length > 0) return { ok: false, error: "Please fix the highlighted fields." };
      const result = await updatePreviewAction(id!, toPayload(draft));
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        return { ok: false, error: result.error };
      }
      return { ok: true };
    },
    () => router.refresh(),
  );

  const set = <K extends keyof PreviewFormValues>(key: K, next: PreviewFormValues[K]) =>
    setValue((v) => ({ ...v, [key]: next }));

  const host = value.subdomain.trim().toLowerCase() || "name";
  const previewUrl = `https://${host}.${baseDomain}`;

  const create = async () => {
    setFormError(null);
    const found = validate(value, true);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFormError("Please fix the highlighted fields.");
      return;
    }
    setCreatingNow(true);
    const result = await createPreviewAction({ ...toPayload(value), code: value.code });
    setCreatingNow(false);
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      setFormError(result.error);
      return;
    }
    setSecret({ url: `https://${result.subdomain}.${baseDomain}`, code: result.code });
  };

  const err = (key: string) => errors[key];
  const text = (key: "clientName" | "projectName" | "targetUrl" | "notes", label: string, extra?: { hint?: string; placeholder?: string; multiline?: boolean; className?: string }) => (
    <Field id={key} label={label} hint={extra?.hint} error={err(key)} className={extra?.className}>
      {extra?.multiline ? (
        <textarea
          id={key}
          rows={3}
          value={value[key]}
          maxLength={2000}
          onChange={(e) => set(key, e.target.value)}
          aria-invalid={Boolean(err(key))}
          className={cn(adminInput, "py-2")}
        />
      ) : (
        <input
          id={key}
          type="text"
          value={value[key]}
          placeholder={extra?.placeholder}
          onChange={(e) => set(key, e.target.value)}
          aria-invalid={Boolean(err(key))}
          aria-describedby={err(key) ? `${key}-error` : undefined}
          className={cn(adminInput, "h-10")}
        />
      )}
    </Field>
  );

  return (
    <form onSubmit={(e) => e.preventDefault()} noValidate className="space-y-4">
      <Panel title="Client" description="Who the preview is for and what it shows. Only you see these names.">
        <div className="grid gap-4 sm:grid-cols-2">
          {text("clientName", "Client name", { placeholder: "Geert Kips" })}
          {text("projectName", "Project name", { placeholder: "Geert Kips Website" })}
        </div>
      </Panel>

      <Panel title="Address" description="The preview is reachable at a private subdomain and shows the target site.">
        <div className="space-y-4">
          <Field
            id="subdomain"
            label="Subdomain"
            error={err("subdomain")}
            hint={`Preview URL: ${previewUrl}. A single lowercase name; letters, numbers and hyphens.`}
          >
            <input
              id="subdomain"
              type="text"
              value={value.subdomain}
              maxLength={63}
              autoCapitalize="off"
              spellCheck={false}
              placeholder="geertkips"
              onChange={(e) => set("subdomain", e.target.value.toLowerCase())}
              aria-invalid={Boolean(err("subdomain"))}
              aria-describedby={err("subdomain") ? "subdomain-error" : undefined}
              className={cn(adminInput, "h-10")}
            />
          </Field>
          {text("targetUrl", "Target URL", {
            placeholder: "https://client-site.example.com",
            hint: "The real website, https only. Visitors never see this address. Changing it signs everyone out.",
          })}
        </div>
      </Panel>

      {creating && (
        <Panel title="Access code" description="Shown once after creating. It is stored only as a one-way hash.">
          <Field id="code" label="Access code" error={err("code")} hint="At least 10 characters. Generate a strong one, or type your own.">
            <div className="flex flex-wrap gap-2">
              <input
                id="code"
                type="text"
                value={value.code}
                autoComplete="off"
                spellCheck={false}
                maxLength={128}
                onChange={(e) => set("code", e.target.value)}
                aria-invalid={Boolean(err("code"))}
                aria-describedby={err("code") ? "code-error" : undefined}
                className={cn(adminInput, "h-10 min-w-0 flex-1 font-mono")}
              />
              <Button
                variant="secondary"
                size="sm"
                icon="none"
                onClick={() => {
                  set("code", generateAccessCode(value.clientName));
                  setErrors((e) => ({ ...e, code: "" }));
                }}
              >
                <RefreshCw aria-hidden className="size-4" /> Generate code
              </Button>
            </div>
          </Field>
        </Panel>
      )}

      <Panel title="Access window">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="expiry" label="Preview expires" error={err("expiry.date")}>
            <AdminSelect
              id="expiry"
              value={value.expiryChoice}
              onChange={(v) => set("expiryChoice", v as PreviewFormValues["expiryChoice"])}
              options={creating ? EXPIRY_OPTIONS : [{ value: "keep", label: `Keep current (${currentExpiryLabel ?? "unchanged"})` }, ...EXPIRY_OPTIONS]}
            />
            {value.expiryChoice === "custom" && (
              <input
                type="date"
                aria-label="Expiry date"
                value={value.expiryDate}
                onChange={(e) => set("expiryDate", e.target.value)}
                className={cn(adminInput, "mt-2 h-10 [color-scheme:dark]")}
              />
            )}
          </Field>
          <Field id="sessionTtlHours" label="Session duration" hint="How long a visitor stays signed in after entering the code.">
            <AdminSelect
              id="sessionTtlHours"
              value={String(value.sessionTtlHours)}
              onChange={(v) => set("sessionTtlHours", Number(v) as PreviewFormValues["sessionTtlHours"])}
              options={SESSION_OPTIONS}
            />
          </Field>
        </div>
      </Panel>

      <Panel title="Notes" description="Private, for you only.">
        {text("notes", "Notes", { multiline: true })}
      </Panel>

      {creating ? (
        <div className="glass-strong sticky bottom-3 z-10 flex items-center justify-end gap-3 rounded-card px-4 py-2.5">
          {formError && (
            <p role="alert" className="mr-auto text-sm text-danger">
              {formError}
            </p>
          )}
          <Button size="sm" onClick={() => void create()} pending={creatingNow} pendingLabel="Creating preview…">
            Create preview
          </Button>
        </div>
      ) : (
        <SaveBar status={status} dirty={dirty} label="Save changes" onSave={() => void save()} />
      )}

      <PreviewSecretDialog
        open={secret !== null}
        title="Preview created"
        url={secret?.url ?? ""}
        code={secret?.code ?? ""}
        onDone={() => {
          setSecret(null);
          router.push("/admin/previews");
          router.refresh();
        }}
      />
    </form>
  );
}

