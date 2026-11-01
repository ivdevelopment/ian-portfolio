"use client";

import { useAppPaths } from "@/lib/crm/paths-context";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { createQuoteAction, updateQuoteAction } from "@/app/(admin)/admin/(panel)/quotes/actions";
import { Button } from "@/components/ui/button";
import { CURRENCIES, DEFAULT_VAT_RATE, MAX_ITEMS, QUOTE_LANGUAGES, QUOTE_LANGUAGE_LABELS, UNIT_SUGGESTIONS, VAT_RATES, type DiscountType } from "@/lib/quotes/constants";
import { itemFromTemplate } from "@/lib/quotes/form";
import { formatCents } from "@/lib/quotes/money";
import { calculateForm, emptyItem, validateDraft, type ItemFormValues, type QuoteFormValues } from "@/lib/quotes/schema";
import type { QuoteSettings, QuoteTemplateRecord } from "@/lib/quotes/types";
import type { ProspectOption } from "@/lib/quotes/queries";
import { cn } from "@/lib/utils";
import { AdminSelect } from "./admin-select";
import { Field, SaveBar } from "./form-bits";
import { QuoteTotalsBlock } from "./quote-ui";
import { Panel, adminInput } from "./ui";
import { useDirtySaveState } from "./use-dirty-save";

const LANGUAGE_OPTIONS = QUOTE_LANGUAGES.map((l) => ({ value: l, label: QUOTE_LANGUAGE_LABELS[l] }));
const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({ value: c, label: c }));
const VAT_OPTIONS = VAT_RATES.map((r) => ({ value: String(r), label: `${r}%` }));
const DISCOUNT_OPTIONS: Array<{ value: DiscountType; label: string }> = [
  { value: "none", label: "No discount" },
  { value: "percent", label: "Percentage of subtotal" },
  { value: "fixed", label: "Fixed amount" },
];

const small = "h-10";
const iconBtn =
  "inline-flex size-9 items-center justify-center rounded-md border border-line text-muted transition-colors " +
  "hover:border-line-strong hover:bg-glass-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Create and edit share one builder. Everything typed is a string; the totals shown here come from the SAME calculator the server
 * uses when it saves (and the PDF when it renders), and the server recalculates from the raw inputs anyway.
 */
export function QuoteForm({
  mode,
  id,
  initial,
  updatedAt,
  status,
  settings,
  templates,
  prospects,
}: {
  mode: "create" | "edit";
  id?: string;
  initial: QuoteFormValues;
  updatedAt?: string;
  status?: "draft" | "ready";
  settings: QuoteSettings;
  templates: QuoteTemplateRecord[];
  prospects: ProspectOption[];
}) {
  const P = useAppPaths();
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const stamp = useRef<string | null>(updatedAt ?? null);

  const { value, setValue, dirty, status: saveStatus, save } = useDirtySaveState<QuoteFormValues>(
    initial,
    async (draft) => {
      const found = validateDraft(draft);
      if (Object.keys(found).length) {
        setErrors(found);
        return { ok: false, error: "Please fix the highlighted fields." };
      }
      setErrors({});
      if (mode === "create") {
        const result = await createQuoteAction(draft);
        if (!result.ok) {
          setErrors(result.fieldErrors ?? {});
          return { ok: false, error: result.error };
        }
        router.push(P.quote(result.id));
        return { ok: true };
      }
      const result = await updateQuoteAction(id!, draft, stamp.current);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        return { ok: false, error: result.error };
      }
      stamp.current = result.updatedAt;
      return { ok: true };
    },
    () => {
      if (mode === "edit") router.refresh();
    },
  );

  const set = <K extends keyof QuoteFormValues>(key: K, next: QuoteFormValues[K]) => setValue((v) => ({ ...v, [key]: next }));
  const setItem = (index: number, patch: Partial<ItemFormValues>) =>
    setValue((v) => ({ ...v, items: v.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) }));
  const move = (index: number, by: -1 | 1) =>
    setValue((v) => {
      const items = [...v.items];
      const target = index + by;
      if (target < 0 || target >= items.length) return v;
      [items[index], items[target]] = [items[target], items[index]];
      return { ...v, items };
    });
  const remove = (index: number) => setValue((v) => ({ ...v, items: v.items.filter((_, i) => i !== index) }));
  const addItem = (item: ItemFormValues) => setValue((v) => ({ ...v, items: [...v.items, item] }));

  const calc = useMemo(() => calculateForm(value), [value]);
  const err = (key: string) => errors[key];
  const money = (cents: number) => formatCents(cents, value.currency, value.language);
  const prospectOptions = useMemo(() => [{ value: "", label: "No prospect" }, ...prospects.map((p) => ({ value: p.id, label: p.companyName }))], [prospects]);

  /** Choosing a prospect fills only EMPTY client fields; nothing typed is overwritten and no address is invented. */
  const pickProspect = (prospectId: string) =>
    setValue((v) => {
      const p = prospects.find((x) => x.id === prospectId);
      if (!p) return { ...v, prospectId };
      return {
        ...v,
        prospectId,
        clientName: v.clientName.trim() ? v.clientName : (p.contactName?.trim() || p.companyName),
        clientCompany: v.clientCompany.trim() ? v.clientCompany : p.companyName,
        clientEmail: v.clientEmail.trim() ? v.clientEmail : (p.email ?? ""),
      };
    });

  const text = (key: "clientName" | "clientCompany" | "clientEmail" | "title", label: string, extra: { type?: string; inputMode?: "email"; className?: string; placeholder?: string } = {}) => (
    <Field id={key} label={label} error={err(key)} className={extra.className}>
      <input
        id={key}
        type={extra.type ?? "text"}
        inputMode={extra.inputMode}
        value={value[key]}
        placeholder={extra.placeholder}
        autoComplete="off"
        onChange={(e) => set(key, e.target.value)}
        aria-invalid={Boolean(err(key))}
        aria-describedby={err(key) ? `${key}-error` : undefined}
        className={cn(adminInput, small)}
      />
    </Field>
  );

  const area = (key: "clientAddress" | "intro" | "notes" | "terms", label: string, rows: number, hint?: string) => (
    <Field id={key} label={label} error={err(key)} hint={hint}>
      <textarea
        id={key}
        rows={rows}
        value={value[key]}
        onChange={(e) => set(key, e.target.value)}
        aria-invalid={Boolean(err(key))}
        className={cn(adminInput, "py-2")}
      />
    </Field>
  );

  return (
    <form onSubmit={(e) => e.preventDefault()} noValidate className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
      <div className="min-w-0 space-y-4">
        {status === "ready" && (
          <p className="rounded-card border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200" role="note">
            This quote is marked <strong>Ready to send</strong>. Saving your changes keeps it ready; the PDF always shows the latest saved version.
          </p>
        )}

        <Panel title="Client" description="A copy is stored on the quote, so later changes to the prospect never alter it.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="prospectId" label="Prospect" className="sm:col-span-2" hint="Optional. Fills empty client fields; the prospect itself is never changed.">
              <AdminSelect id="prospectId" value={value.prospectId} onChange={pickProspect} options={prospectOptions} />
            </Field>
            {text("clientName", "Client name", { placeholder: "Geert Kips" })}
            {text("clientCompany", "Company")}
            {text("clientEmail", "Email", { type: "email", inputMode: "email" })}
            <div className="sm:col-span-2">{area("clientAddress", "Address", 3, "Only what you enter is shown on the quote.")}</div>
          </div>
        </Panel>

        <Panel title="Quote">
          <div className="grid gap-4 sm:grid-cols-2">
            {text("title", "Title", { className: "sm:col-span-2", placeholder: "Website for …" })}
            <Field id="language" label="Language" error={err("language")}>
              <AdminSelect id="language" value={value.language} onChange={(v) => set("language", v as QuoteFormValues["language"])} options={LANGUAGE_OPTIONS} />
            </Field>
            <Field id="currency" label="Currency" error={err("currency")}>
              <AdminSelect id="currency" value={value.currency} onChange={(v) => set("currency", v as QuoteFormValues["currency"])} options={CURRENCY_OPTIONS} />
            </Field>
            <Field id="validUntil" label="Valid until" error={err("validUntil")}>
              <input id="validUntil" type="date" value={value.validUntil} onChange={(e) => set("validUntil", e.target.value)} aria-invalid={Boolean(err("validUntil"))} className={cn(adminInput, small, "[color-scheme:dark]")} />
            </Field>
            <div className="sm:col-span-2">{area("intro", "Introduction", 4, "Shown under the title on the quote.")}</div>
          </div>
        </Panel>

        <Panel
          title="Line items"
          description="Amounts exclude VAT; choose the VAT rate per line."
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <ServiceMenu templates={templates} onPick={(t) => addItem(itemFromTemplate(t, settings))} disabled={value.items.length >= MAX_ITEMS} />
              <Button size="sm" variant="secondary" icon="none" onClick={() => addItem(emptyItem({ taxRate: String(settings.defaultTaxRate ?? DEFAULT_VAT_RATE) }))} disabled={value.items.length >= MAX_ITEMS}>
                <Plus aria-hidden className="size-4" />
                Add line
              </Button>
            </div>
          }
        >
          {err("items") && (
            <p role="alert" className="mb-3 text-sm text-danger">
              {err("items")}
            </p>
          )}
          {value.items.length === 0 ? (
            <p className="rounded-card border border-dashed border-line-strong p-6 text-center text-sm text-muted">No lines yet. Add a line or pick a service.</p>
          ) : (
            <ol className="space-y-3">
              {value.items.map((item, i) => {
                const line = calc.totals?.lines[i];
                const at = (f: string) => `items.${i}.${f}`;
                const id = (f: string) => `item-${item.key}-${f}`;
                return (
                  <li key={item.key} className="rounded-card border border-line bg-glass-strong/40 p-3 sm:p-4" aria-label={`Line ${i + 1}`}>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted">Line {i + 1}</span>
                      <div className="flex items-center gap-1.5">
                        <button type="button" className={iconBtn} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move line ${i + 1} up`}>
                          <ArrowUp aria-hidden className="size-4" />
                        </button>
                        <button type="button" className={iconBtn} onClick={() => move(i, 1)} disabled={i === value.items.length - 1} aria-label={`Move line ${i + 1} down`}>
                          <ArrowDown aria-hidden className="size-4" />
                        </button>
                        <button type="button" className={cn(iconBtn, "hover:text-danger")} onClick={() => remove(i)} aria-label={`Remove line ${i + 1}`}>
                          <Trash2 aria-hidden className="size-4" />
                        </button>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-6">
                      <Field id={id("title")} label="Title" error={err(at("title"))} className="sm:col-span-6">
                        <input id={id("title")} value={item.title} onChange={(e) => setItem(i, { title: e.target.value })} autoComplete="off" aria-invalid={Boolean(err(at("title")))} className={cn(adminInput, small)} />
                      </Field>
                      <Field id={id("description")} label="Description" error={err(at("description"))} className="sm:col-span-6">
                        <textarea id={id("description")} rows={2} value={item.description} onChange={(e) => setItem(i, { description: e.target.value })} className={cn(adminInput, "py-2")} />
                      </Field>
                      <Field id={id("quantity")} label="Quantity" error={err(at("quantity"))} className="sm:col-span-1">
                        <input id={id("quantity")} inputMode="decimal" value={item.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} aria-invalid={Boolean(err(at("quantity")))} className={cn(adminInput, small, "tabular-nums")} />
                      </Field>
                      <Field id={id("unit")} label="Unit" error={err(at("unit"))} className="sm:col-span-1">
                        <input id={id("unit")} list="quote-units" value={item.unit} onChange={(e) => setItem(i, { unit: e.target.value })} autoComplete="off" className={cn(adminInput, small)} />
                      </Field>
                      <Field id={id("unitPrice")} label={`Unit price (${value.currency})`} error={err(at("unitPrice"))} className="sm:col-span-2">
                        <input id={id("unitPrice")} inputMode="decimal" value={item.unitPrice} placeholder="0.00" onChange={(e) => setItem(i, { unitPrice: e.target.value })} aria-invalid={Boolean(err(at("unitPrice")))} className={cn(adminInput, small, "tabular-nums")} />
                      </Field>
                      <Field id={id("discountPercent")} label="Discount %" error={err(at("discountPercent"))} className="sm:col-span-1">
                        <input id={id("discountPercent")} inputMode="decimal" value={item.discountPercent} placeholder="0" onChange={(e) => setItem(i, { discountPercent: e.target.value })} aria-invalid={Boolean(err(at("discountPercent")))} className={cn(adminInput, small, "tabular-nums")} />
                      </Field>
                      <Field id={id("taxRate")} label="VAT" error={err(at("taxRate"))} className="sm:col-span-1">
                        <AdminSelect id={id("taxRate")} value={item.taxRate} onChange={(v) => setItem(i, { taxRate: v })} options={VAT_OPTIONS} />
                      </Field>
                    </div>
                    <p className="mt-3 flex flex-wrap items-baseline justify-end gap-x-4 text-sm tabular-nums text-muted" data-testid={`line-total-${i}`}>
                      {line ? (
                        <>
                          <span>
                            Excl. VAT <span className="text-ink">{money(line.subtotal)}</span>
                          </span>
                          <span>
                            Incl. VAT <span className="text-ink">{money(line.subtotal - line.quoteDiscountShare + line.tax)}</span>
                          </span>
                        </>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
          <datalist id="quote-units">
            {UNIT_SUGGESTIONS[value.language].map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </Panel>

        <Panel title="Discount" description="Optional, on top of any per-line discounts. It is spread over the lines so VAT stays correct.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="discountType" label="Type" error={err("discountType")}>
              <AdminSelect id="discountType" value={value.discountType} onChange={(v) => setValue((x) => ({ ...x, discountType: v as DiscountType, discountValue: v === "none" ? "" : x.discountValue }))} options={DISCOUNT_OPTIONS} />
            </Field>
            {value.discountType !== "none" && (
              <Field id="discountValue" label={value.discountType === "percent" ? "Percentage" : `Amount (${value.currency})`} error={err("discountValue")}>
                <input id="discountValue" inputMode="decimal" value={value.discountValue} onChange={(e) => set("discountValue", e.target.value)} aria-invalid={Boolean(err("discountValue"))} className={cn(adminInput, small, "tabular-nums")} />
              </Field>
            )}
          </div>
        </Panel>

        <Panel title="Notes and terms">
          <div className="grid gap-4">
            {area("notes", "Notes", 3, "Printed on the quote, under the totals.")}
            {area("terms", "Terms and conditions", 5)}
          </div>
        </Panel>
      </div>

      <aside className="min-w-0 xl:sticky xl:top-4">
        <Panel title="Totals">
          {calc.totals ? (
            <QuoteTotalsBlock totals={calc.totals} currency={value.currency} language={value.language} />
          ) : (
            <p role="alert" className="text-sm text-danger">
              {calc.error}
            </p>
          )}
        </Panel>
      </aside>

      <div className="xl:col-span-2">
        <SaveBar status={saveStatus} dirty={dirty} label={mode === "create" ? "Create quote" : "Save changes"} onSave={() => void save()} />
      </div>
    </form>
  );
}

/** "+ Add service": pick a template and get an editable copy of it as a new line. */
function ServiceMenu({ templates, onPick, disabled }: { templates: QuoteTemplateRecord[]; onPick: (t: QuoteTemplateRecord) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  if (templates.length === 0) return null;
  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          root.current?.querySelector("button")?.focus();
        }
      }}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <Button size="sm" variant="secondary" icon="none" aria-haspopup="true" aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        <Plus aria-hidden className="size-4" />
        Add service
      </Button>
      {open && (
        <ul className="glass-strong absolute right-0 z-20 mt-2 max-h-72 w-72 max-w-[calc(100vw-2rem)] overflow-auto rounded-card border border-line-strong p-1 shadow-lift" aria-label="Services">
          {templates.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="flex w-full items-baseline justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-glass-strong focus-visible:bg-glass-strong focus-visible:outline-none"
                onClick={() => {
                  onPick(t);
                  setOpen(false);
                }}
              >
                <span>{t.name}</span>
                <span className="text-xs text-subtle tabular-nums">{t.defaultUnitPrice ? `€ ${t.defaultUnitPrice}` : "price per quote"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
