"use client";

import { useAppPaths } from "@/lib/crm/paths-context";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createProspectAction, updateProspectAction } from "@/app/(admin)/admin/(panel)/prospects/actions";
import {
  DELIVERY_LABELS,
  DELIVERY_STATUSES,
  PRIORITY_LABELS,
  PROSPECT_PRIORITIES,
  PROSPECT_STATUSES,
  STATUS_LABELS,
} from "@/lib/prospects/constants";
import { emptyProspectForm, validateProspectForm, type ProspectFormValues } from "@/lib/schemas/prospect";
import { cn } from "@/lib/utils";
import { AdminSelect } from "./admin-select";
import { Field, SaveBar } from "./form-bits";
import { Panel, adminInput } from "./ui";
import { useDirtySaveState } from "./use-dirty-save";

const STATUS_OPTIONS = PROSPECT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }));
const PRIORITY_OPTIONS = PROSPECT_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }));
const DELIVERY_OPTIONS = DELIVERY_STATUSES.map((d) => ({ value: d, label: DELIVERY_LABELS[d] }));

type TextKey = "companyName" | "sector" | "city" | "websiteUrl" | "email" | "contactName" | "phone" | "source" | "notes" | "estimatedValue" | "quoteValue";
type DayKey = "firstContactOn" | "lastContactOn" | "nextFollowUpOn";

/**
 * Create and edit share one form. The save button is disabled while nothing changed (the dirty state is the
 * difference between the current values and the last saved snapshot), shows "Saving…", and there is no
 * "saved at" clock.
 */
export function ProspectForm({
  mode,
  id,
  initial = emptyProspectForm,
  sectors = [],
}: {
  mode: "create" | "edit";
  id?: string;
  initial?: ProspectFormValues;
  /** Existing sectors, suggested while typing. */
  sectors?: string[];
}) {
  const P = useAppPaths();
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { value, setValue, dirty, status, save } = useDirtySaveState<ProspectFormValues>(
    initial,
    async (draft) => {
      const checked = validateProspectForm(draft);
      if (!checked.ok) {
        setErrors(checked.errors);
        return { ok: false, error: "Please fix the highlighted fields." };
      }
      setErrors({});
      const result = mode === "create" ? await createProspectAction(draft) : await updateProspectAction(id!, draft);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        return { ok: false, error: result.error };
      }
      if (mode === "create" && "id" in result) router.push(P.prospect(String(result.id)));
      return { ok: true };
    },
    () => router.refresh(),
  );

  const set = <K extends keyof ProspectFormValues>(key: K, next: ProspectFormValues[K]) => setValue((v) => ({ ...v, [key]: next }));
  const err = (key: string) => errors[key];

  const text = (
    key: TextKey,
    label: string,
    extra: { placeholder?: string; type?: string; inputMode?: "text" | "email" | "tel" | "decimal" | "url"; list?: string; hint?: string; className?: string } = {},
  ) => (
    <Field id={key} label={label} error={err(key)} hint={extra.hint} className={extra.className}>
      <input
        id={key}
        type={extra.type ?? "text"}
        inputMode={extra.inputMode}
        value={value[key]}
        list={extra.list}
        placeholder={extra.placeholder}
        autoComplete="off"
        onChange={(e) => set(key, e.target.value)}
        aria-invalid={Boolean(err(key))}
        aria-describedby={err(key) ? `${key}-error` : undefined}
        className={cn(adminInput, "h-10")}
      />
    </Field>
  );

  const day = (key: DayKey, label: string) => (
    <Field id={key} label={label} error={err(key)}>
      <input
        id={key}
        type="date"
        value={value[key]}
        onChange={(e) => set(key, e.target.value)}
        aria-invalid={Boolean(err(key))}
        className={cn(adminInput, "h-10 [color-scheme:dark]")}
      />
    </Field>
  );

  return (
    <form onSubmit={(e) => e.preventDefault()} noValidate className="space-y-4">
      <Panel title="Company">
        <div className="grid gap-4 sm:grid-cols-2">
          {text("companyName", "Company name", { className: "sm:col-span-2", placeholder: "Geert Kips" })}
          {text("sector", "Sector", { list: "prospect-sectors" })}
          {text("city", "City")}
          {text("websiteUrl", "Website", { className: "sm:col-span-2", inputMode: "url", placeholder: "https://example.be" })}
        </div>
        <datalist id="prospect-sectors">
          {sectors.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Panel>

      <Panel title="Contact">
        <div className="grid gap-4 sm:grid-cols-2">
          {text("email", "Email", { inputMode: "email", placeholder: "info@example.be" })}
          {text("contactName", "Contact person")}
          {text("phone", "Phone", { inputMode: "tel" })}
        </div>
      </Panel>

      <Panel title="Sales">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="status" label="Status" error={err("status")}>
            <AdminSelect id="status" value={value.status} onChange={(v) => set("status", v as ProspectFormValues["status"])} options={STATUS_OPTIONS} />
          </Field>
          <Field id="priority" label="Priority" error={err("priority")}>
            <AdminSelect id="priority" value={value.priority} onChange={(v) => set("priority", v as ProspectFormValues["priority"])} options={PRIORITY_OPTIONS} />
          </Field>
          {text("estimatedValue", "Estimated value (€)", { inputMode: "decimal", placeholder: "1500", hint: "Leave empty when unknown: a blank is not counted as €0." })}
          {text("quoteValue", "Quote value (€)", { inputMode: "decimal", placeholder: "1500" })}
          <Field id="deliveryStatus" label="Outreach delivery" hint="Whether the first message is known to have gone out." error={err("deliveryStatus")}>
            <AdminSelect id="deliveryStatus" value={value.deliveryStatus} onChange={(v) => set("deliveryStatus", v as ProspectFormValues["deliveryStatus"])} options={DELIVERY_OPTIONS} />
          </Field>
          {text("source", "Source", { placeholder: "Where this lead came from" })}
        </div>
      </Panel>

      <Panel title="Follow-up">
        <div className="grid gap-4 sm:grid-cols-3">
          {day("firstContactOn", "First contact")}
          {day("lastContactOn", "Last contact")}
          {day("nextFollowUpOn", "Next follow-up")}
        </div>
      </Panel>

      <Panel title="Notes" description="Private, for you only.">
        <Field id="notes" label="Notes" error={err("notes")}>
          <textarea
            id="notes"
            rows={5}
            value={value.notes}
            maxLength={10000}
            onChange={(e) => set("notes", e.target.value)}
            aria-invalid={Boolean(err("notes"))}
            className={cn(adminInput, "py-2")}
          />
        </Field>
      </Panel>

      <SaveBar status={status} dirty={dirty} label={mode === "create" ? "Create prospect" : "Save changes"} onSave={() => void save()} />
    </form>
  );
}
