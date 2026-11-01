"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { deleteTemplateAction, saveTemplateAction } from "@/app/(admin)/admin/(panel)/quotes/actions";
import { Button } from "@/components/ui/button";
import { VAT_RATES } from "@/lib/quotes/constants";
import type { QuoteTemplateRecord } from "@/lib/quotes/types";
import { cn } from "@/lib/utils";
import { AdminSelect } from "./admin-select";
import { ConfirmDialog } from "./confirm-dialog";
import { Field, SaveBar } from "./form-bits";
import { Badge, EmptyState, Panel, adminInput } from "./ui";
import { useDirtySaveState } from "./use-dirty-save";

const VAT_OPTIONS = VAT_RATES.map((r) => ({ value: String(r), label: `${r}%` }));
const BLANK: QuoteTemplateRecord = { id: "", name: "", description: "", defaultUnit: "", defaultUnitPrice: "", defaultTaxRate: 21, active: true, sortOrder: 0 };

/** The reusable services offered by “Add service” in the quote builder. A quote copies a service; it never links to it. */
export function QuoteTemplatesManager({ templates }: { templates: QuoteTemplateRecord[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<QuoteTemplateRecord | null>(null);
  const [deleting, setDeleting] = useState<QuoteTemplateRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <Panel
        title="Services"
        description="Quotes copy a service when you add it, so changing or deleting one here never alters an existing quote. Prices are left empty on purpose: set yours."
        actions={
          <Button size="sm" icon="none" onClick={() => setEditing({ ...BLANK })}>
            <Plus aria-hidden className="size-4" />
            New service
          </Button>
        }
      >
        {templates.length === 0 ? (
          <EmptyState>No services yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-line/60">
            {templates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {t.name}
                    {!t.active && <Badge>Inactive</Badge>}
                  </p>
                  <p className="text-xs text-muted tabular-nums">
                    {t.defaultUnitPrice ? `€ ${t.defaultUnitPrice}` : "no default price"}
                    {t.defaultUnit ? ` per ${t.defaultUnit}` : ""} · VAT {t.defaultTaxRate}%
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" icon="none" onClick={() => setEditing(t)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="secondary" icon="none" className="text-danger" onClick={() => setDeleting(t)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {editing && (
        <TemplateForm
          key={editing.id || "new"}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this service?"
        confirmLabel="Delete"
        pending={pending}
        error={error}
        onClose={() => {
          setDeleting(null);
          setError(null);
        }}
        onConfirm={() =>
          startTransition(async () => {
            const result = await deleteTemplateAction(deleting!.id);
            if (!result.ok) return setError(result.error);
            setDeleting(null);
            router.refresh();
          })
        }
      >
        “{deleting?.name}” is removed from the list. Quotes that already use it keep their lines.
      </ConfirmDialog>
    </div>
  );
}

function TemplateForm({ initial, onClose, onSaved }: { initial: QuoteTemplateRecord; onClose: () => void; onSaved: () => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { value, setValue, dirty, status, save } = useDirtySaveState<QuoteTemplateRecord>(
    initial,
    async (draft) => {
      const result = await saveTemplateAction(draft.id || null, draft);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        return { ok: false, error: result.error };
      }
      setErrors({});
      return { ok: true };
    },
    onSaved,
  );
  const set = <K extends keyof QuoteTemplateRecord>(key: K, next: QuoteTemplateRecord[K]) => setValue((v) => ({ ...v, [key]: next }));

  return (
    <form onSubmit={(e) => e.preventDefault()} noValidate>
      <Panel
        title={initial.id ? `Edit “${initial.name}”` : "New service"}
        actions={
          <Button size="sm" variant="secondary" icon="none" onClick={onClose}>
            Close
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="tpl-name" label="Name" error={errors.name} className="sm:col-span-2">
            <input id="tpl-name" value={value.name} onChange={(e) => set("name", e.target.value)} autoComplete="off" aria-invalid={Boolean(errors.name)} className={cn(adminInput, "h-10")} />
          </Field>
          <Field id="tpl-description" label="Description" error={errors.description} className="sm:col-span-2">
            <textarea id="tpl-description" rows={3} value={value.description} onChange={(e) => set("description", e.target.value)} className={cn(adminInput, "py-2")} />
          </Field>
          <Field id="tpl-unit" label="Default unit" error={errors.defaultUnit}>
            <input id="tpl-unit" value={value.defaultUnit} onChange={(e) => set("defaultUnit", e.target.value)} autoComplete="off" className={cn(adminInput, "h-10")} />
          </Field>
          <Field id="tpl-price" label="Default unit price (€)" hint="Leave empty to price it per quote." error={errors.defaultUnitPrice}>
            <input id="tpl-price" inputMode="decimal" value={value.defaultUnitPrice} onChange={(e) => set("defaultUnitPrice", e.target.value)} aria-invalid={Boolean(errors.defaultUnitPrice)} className={cn(adminInput, "h-10 tabular-nums")} />
          </Field>
          <Field id="tpl-vat" label="Default VAT" error={errors.defaultTaxRate}>
            <AdminSelect id="tpl-vat" value={String(value.defaultTaxRate)} onChange={(v) => set("defaultTaxRate", Number(v))} options={VAT_OPTIONS} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={value.active} onChange={(e) => set("active", e.target.checked)} />
            Offer in “Add service”
          </label>
        </div>
        <SaveBar status={status} dirty={dirty} label={initial.id ? "Save service" : "Create service"} onSave={() => void save()} />
      </Panel>
    </form>
  );
}
