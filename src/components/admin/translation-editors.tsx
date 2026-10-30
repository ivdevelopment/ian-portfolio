"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveServicesTranslationAction } from "@/app/(admin)/admin/(panel)/pages/actions";
import { saveProjectTranslationAction } from "@/app/(admin)/admin/(panel)/projects/actions";
import { missingTranslationFields, type ProjectTranslation } from "@/lib/schemas/project-translation";
import { SaveBar, type SaveStatus } from "./form-bits";
import { Panel, adminInput } from "./ui";

function nowLabel() {
  return new Intl.DateTimeFormat("en-GB", { timeStyle: "short" }).format(new Date());
}

/** Label + input + the English text underneath for reference. */
function TranslationField({
  id,
  label,
  value,
  onChange,
  english,
  multiline,
  rows = 3,
  maxLength,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  english: string;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  hint?: string;
}) {
  const common = {
    id,
    value,
    maxLength,
    placeholder: english || undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
  };
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {multiline ? (
        <textarea rows={rows} className={`${adminInput} py-2`} {...common} />
      ) : (
        <input type="text" className={`${adminInput} h-10`} {...common} />
      )}
      <p className="mt-1 text-xs text-subtle">
        {hint ? `${hint} ` : ""}
        {english ? "English: " : "No English text."}
        {english && <span className="text-muted">{english.length > 140 ? `${english.slice(0, 140)}…` : english}</span>}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- services */

export type ServiceTranslationRow = {
  id: string;
  slug: string;
  english: { title: string; description: string; includes: string[] };
  title: string;
  description: string;
  includesText: string;
};

/** Dutch title, description and includes list for each service. Slugs, icons and order stay on the English tab. */
export function ServicesTranslationEditor({ initial }: { initial: ServiceTranslationRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [dirty, setDirty] = useState(false);

  const update = (i: number, patch: Partial<ServiceTranslationRow>) => {
    setRows((current) => current.map((row, index) => (index === i ? { ...row, ...patch } : row)));
    setDirty(true);
    setStatus({ kind: "idle" });
  };

  const save = async () => {
    setStatus({ kind: "saving" });
    const result = await saveServicesTranslationAction(
      rows.map((r) => ({ id: r.id, title: r.title, description: r.description, includesText: r.includesText })),
    );
    if (!result.ok) {
      setStatus({ kind: "error", message: result.error });
      return;
    }
    setDirty(false);
    setStatus({ kind: "saved", at: nowLabel() });
    router.refresh();
  };

  if (rows.length === 0) return <p className="text-sm text-muted">No services yet — add them on the English tab first.</p>;

  return (
    <div className="space-y-4">
      {rows.map((row, i) => (
        <Panel key={row.id} title={row.english.title} description={`/services#${row.slug}`}>
          <div className="space-y-4">
            <TranslationField
              id={`svc-${i}-title`}
              label="Title (Dutch)"
              value={row.title}
              onChange={(title) => update(i, { title })}
              english={row.english.title}
              maxLength={80}
            />
            <TranslationField
              id={`svc-${i}-description`}
              label="Description (Dutch)"
              value={row.description}
              onChange={(description) => update(i, { description })}
              english={row.english.description}
              multiline
              maxLength={300}
            />
            <TranslationField
              id={`svc-${i}-includes`}
              label="What's included (Dutch)"
              value={row.includesText}
              onChange={(includesText) => update(i, { includesText })}
              english={row.english.includes.join(" · ")}
              multiline
              rows={5}
              maxLength={2000}
              hint="One item per line, in the same order as the English list."
            />
          </div>
        </Panel>
      ))}
      <SaveBar status={status} dirty={dirty} label="Save Dutch services" onSave={() => void save()} />
    </div>
  );
}

/* ---------------------------------------------------------------- projects */

export type ProjectTranslationInitial = ProjectTranslation;
export type ProjectEnglish = {
  title: string;
  subtitle: string;
  shortDescription: string;
  description: string;
  category: string;
  features: string[];
};

/**
 * Dutch version of one project. Saved separately from the main editor, so
 * a missing translation never blocks saving or publishing: untranslated fields
 * fall back to the English text on the Dutch pages. Names and the slug are shared.
 */
export function ProjectTranslationPanel({
  projectId,
  initial,
  english,
}: {
  projectId: string;
  initial: ProjectTranslation;
  english: ProjectEnglish;
}) {
  const router = useRouter();
  const [value, setValue] = useState({ ...initial, featuresText: initial.features.join("\n") });
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [dirty, setDirty] = useState(false);

  const set = <K extends keyof typeof value>(key: K, next: (typeof value)[K]) => {
    setValue((v) => ({ ...v, [key]: next }));
    setDirty(true);
    setStatus({ kind: "idle" });
  };

  const missing = missingTranslationFields({ ...value, features: value.featuresText.split("\n") });

  const save = async () => {
    setStatus({ kind: "saving" });
    const { featuresText, ...rest } = value;
    const result = await saveProjectTranslationAction(projectId, {
      ...rest,
      features: featuresText
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean),
    });
    if (!result.ok) {
      setStatus({ kind: "error", message: result.error });
      return;
    }
    setDirty(false);
    setStatus({ kind: "saved", at: nowLabel() });
    router.refresh();
  };

  return (
    <Panel
      title="Dutch translation"
      description="Shown on the Dutch site (the default). Leave a field empty to show the English text instead. Brand and product names, the slug and all media are shared."
    >
      <p
        role="status"
        className={missing.length === 0 ? "mb-4 text-sm text-muted" : "mb-4 text-sm text-warm"}
      >
        {missing.length === 0
          ? "Dutch translation complete."
          : `Dutch translation incomplete — still in English: ${missing.join(", ")}.`}
      </p>
      <div className="space-y-4">
        <TranslationField id="nl-title" label="Title" value={value.title} onChange={(v) => set("title", v)} english={english.title} maxLength={120} hint="Only if the title itself should differ (brand names stay as they are)." />
        <TranslationField id="nl-subtitle" label="Subtitle" value={value.subtitle} onChange={(v) => set("subtitle", v)} english={english.subtitle} maxLength={160} />
        <TranslationField id="nl-category" label="Category" value={value.category} onChange={(v) => set("category", v)} english={english.category} maxLength={80} />
        <TranslationField id="nl-short" label="Short description" value={value.shortDescription} onChange={(v) => set("shortDescription", v)} english={english.shortDescription} multiline maxLength={400} />
        <TranslationField id="nl-description" label="Description" value={value.description} onChange={(v) => set("description", v)} english={english.description} multiline rows={8} maxLength={8000} />
        <TranslationField id="nl-features" label="Key features" value={value.featuresText} onChange={(v) => set("featuresText", v)} english={english.features.join(" · ")} multiline rows={5} hint="One feature per line." />
      </div>
      <SaveBar status={status} dirty={dirty} label="Save Dutch translation" onSave={() => void save()} />
    </Panel>
  );
}
