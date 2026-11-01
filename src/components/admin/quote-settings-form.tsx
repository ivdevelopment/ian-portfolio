"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveQuoteSettingsAction } from "@/app/(admin)/admin/(panel)/quotes/actions";
import { QUOTE_LANGUAGES, QUOTE_LANGUAGE_LABELS, VAT_RATES } from "@/lib/quotes/constants";
import type { QuoteSettings } from "@/lib/quotes/types";
import { cn } from "@/lib/utils";
import { AdminSelect } from "./admin-select";
import { Field, SaveBar } from "./form-bits";
import { Panel, adminInput } from "./ui";
import { useDirtySaveState } from "./use-dirty-save";

const LANGUAGE_OPTIONS = QUOTE_LANGUAGES.map((l) => ({ value: l, label: QUOTE_LANGUAGE_LABELS[l] }));
const VAT_OPTIONS = VAT_RATES.map((r) => ({ value: String(r), label: `${r}%` }));

type TextKey = "businessName" | "businessTagline" | "businessEmail" | "businessWebsite" | "businessPhone" | "businessAddress" | "businessVatNumber" | "businessIban";

/** Defaults for new quotes plus the business details printed on the PDF. Empty fields are simply not printed. */
export function QuoteSettingsForm({ initial }: { initial: QuoteSettings }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { value, setValue, dirty, status, save } = useDirtySaveState<QuoteSettings>(
    initial,
    async (draft) => {
      const result = await saveQuoteSettingsAction(draft);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        return { ok: false, error: result.error };
      }
      setErrors({});
      return { ok: true };
    },
    () => router.refresh(),
  );
  const set = <K extends keyof QuoteSettings>(key: K, next: QuoteSettings[K]) => setValue((v) => ({ ...v, [key]: next }));

  const text = (key: TextKey, label: string, hint?: string, className?: string) => (
    <Field id={key} label={label} hint={hint} error={errors[key]} className={className}>
      <input id={key} value={value[key]} onChange={(e) => set(key, e.target.value)} autoComplete="off" aria-invalid={Boolean(errors[key])} className={cn(adminInput, "h-10")} />
    </Field>
  );

  return (
    <form onSubmit={(e) => e.preventDefault()} noValidate className="space-y-4">
      <Panel title="Defaults for new quotes">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="defaultLanguage" label="Language" error={errors.defaultLanguage}>
            <AdminSelect id="defaultLanguage" value={value.defaultLanguage} onChange={(v) => set("defaultLanguage", v as QuoteSettings["defaultLanguage"])} options={LANGUAGE_OPTIONS} />
          </Field>
          <Field id="defaultTaxRate" label="VAT rate" hint="Preselected for new lines. You choose per line." error={errors.defaultTaxRate}>
            <AdminSelect id="defaultTaxRate" value={String(value.defaultTaxRate)} onChange={(v) => set("defaultTaxRate", Number(v))} options={VAT_OPTIONS} />
          </Field>
          <Field id="defaultValidityDays" label="Valid for (days)" error={errors.defaultValidityDays}>
            <input
              id="defaultValidityDays"
              inputMode="numeric"
              value={String(value.defaultValidityDays)}
              onChange={(e) => set("defaultValidityDays", Number(e.target.value.replace(/\D/g, "")) || 0)}
              aria-invalid={Boolean(errors.defaultValidityDays)}
              className={cn(adminInput, "h-10 tabular-nums")}
            />
          </Field>
          <Field id="defaultIntro" label="Introduction" hint="Prefilled on new quotes. Leave empty for none." error={errors.defaultIntro} className="sm:col-span-3">
            <textarea id="defaultIntro" rows={4} value={value.defaultIntro} onChange={(e) => set("defaultIntro", e.target.value)} className={cn(adminInput, "py-2")} />
          </Field>
          <Field id="defaultTerms" label="Terms and conditions" hint="Prefilled on new quotes. Leave empty for none." error={errors.defaultTerms} className="sm:col-span-3">
            <textarea id="defaultTerms" rows={6} value={value.defaultTerms} onChange={(e) => set("defaultTerms", e.target.value)} className={cn(adminInput, "py-2")} />
          </Field>
        </div>
      </Panel>

      <Panel title="Business details" description="Printed in the header and footer of the PDF. Anything left empty is not shown.">
        <div className="grid gap-4 sm:grid-cols-2">
          {text("businessName", "Name")}
          {text("businessTagline", "Tagline")}
          {text("businessEmail", "Email")}
          {text("businessWebsite", "Website")}
          {text("businessPhone", "Phone")}
          {text("businessVatNumber", "VAT number", "Only printed when you fill it in.")}
          {text("businessIban", "IBAN", "Only printed when you fill it in.")}
          <Field id="businessAddress" label="Address" error={errors.businessAddress} className="sm:col-span-2">
            <textarea id="businessAddress" rows={3} value={value.businessAddress} onChange={(e) => set("businessAddress", e.target.value)} className={cn(adminInput, "py-2")} />
          </Field>
        </div>
      </Panel>

      <SaveBar status={status} dirty={dirty} onSave={() => void save()} />
    </form>
  );
}
