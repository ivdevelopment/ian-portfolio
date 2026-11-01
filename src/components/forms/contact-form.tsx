"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { BUDGETS, PROJECT_TYPES } from "@/data/inquiry-options";
import { useDictionary, useLocale } from "@/i18n/context";
import { formatBudgetLabel } from "@/i18n/format";
import { createInquirySchema, type InquiryResult, type InquiryValues } from "@/lib/schemas/inquiry";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TurnstileWidget, turnstileEnabled, type TurnstileHandle } from "./turnstile-widget";

const inputClass =
  "w-full rounded-md border border-line bg-glass px-4 text-ink placeholder:text-subtle transition-colors duration-300 " +
  "hover:border-line-strong focus-visible:border-accent focus-visible:outline-none aria-[invalid=true]:border-danger";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-sm text-danger">
      {message}
    </p>
  );
}

function ChoiceGroup({
  legend,
  options,
  error,
  errorId,
  register,
}: {
  legend: string;
  options: readonly { value: string; label: string }[];
  error?: string;
  errorId: string;
  register: React.InputHTMLAttributes<HTMLInputElement> & {
    ref?: React.Ref<HTMLInputElement>;
  };
}) {
  return (
    <fieldset aria-describedby={error ? errorId : undefined}>
      <legend className="mb-2.5 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.value} className="cursor-pointer">
            <input type="radio" value={option.value} className="peer sr-only" {...register} />
            <span
              className={cn(
                "block rounded-full border border-line px-4 py-2 text-sm text-muted transition-[background-color,border-color,color] duration-300",
                "hover:border-line-strong hover:text-ink",
                "peer-checked:border-accent/60 peer-checked:bg-accent-soft peer-checked:text-ink",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent",
              )}
            >
              {option.label}
            </span>
          </label>
        ))}
      </div>
      <FieldError id={errorId} message={error} />
    </fieldset>
  );
}

export function ContactForm() {
  const dict = useDictionary();
  const locale = useLocale();
  const f = dict.contact.form;
  const [result, setResult] = useState<InquiryResult | null>(null);
  const openedAt = useRef(0);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle | null>(null);
  const [stale, setStale] = useState(false);

  // Measured on the client (in an effect, so prerendering never reads the clock).
  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<InquiryValues>({
    resolver: zodResolver(createInquirySchema(dict.contact.validation)),
    mode: "onTouched",
    defaultValues: { name: "", email: "", message: "", company: "" },
  });

  const send = async (values: InquiryValues, elapsedMs: number) => {
    setResult(null);
    if (turnstileEnabled && !turnstileToken) {
      setResult({
        status: "error",
        message: f.securityRunning,
      });
      return;
    }
    setStale(false);
    try {
      const http = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, elapsedMs, turnstileToken, locale }),
        cache: "no-store",
      });
      const response = (await http.json().catch(() => null)) as InquiryResult | null;
      // Anything that isn't our JSON contract (404/5xx page, proxy error) means this
      // page is out of step with the server — typically an old deployment still open.
      if (!response || typeof response.status !== "string") {
        setStale(true);
        setResult({
          status: "error",
          message: f.stale,
        });
        return;
      }
      if (response.status === "invalid") {
        for (const [field, messages] of Object.entries(response.fieldErrors)) {
          const message = messages?.[0];
          if (message) setError(field as keyof InquiryValues, { message });
        }
      }
      if (response.status === "sent") reset();
      setResult(response);
    } catch {
      setResult({
        status: "error",
        message: f.network,
      });
    } finally {
      // Turnstile tokens are single use.
      turnstile.current?.reset();
    }
  };

  return (
    <form
      onSubmit={(event) => {
        // Read the clock in the event handler, not during render.
        const elapsedMs = Date.now() - openedAt.current;
        void handleSubmit((values) => send(values, elapsedMs))(event);
      }}
      // Never fall back to a GET (which would put personal data in the URL) if JS hasn't hydrated yet.
      method="post"
      noValidate
      className="glass rounded-panel p-6 sm:p-9"
    >
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
        <div className="space-y-6">
          <div>
            <label htmlFor="name" className="mb-2 block text-sm font-medium">
              {f.name}
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              placeholder={f.namePlaceholder}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? "name-error" : undefined}
              className={cn(inputClass, "h-12")}
              {...register("name")}
            />
            <FieldError id="name-error" message={errors.name?.message} />
          </div>

          <div>
            <label htmlFor="email" className="mb-2 block text-sm font-medium">
              {f.email}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder={f.emailPlaceholder}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "email-error" : undefined}
              className={cn(inputClass, "h-12")}
              {...register("email")}
            />
            <FieldError id="email-error" message={errors.email?.message} />
          </div>

          <ChoiceGroup
            legend={f.projectType}
            options={PROJECT_TYPES.map((value) => ({ value, label: dict.contact.projectTypes[value] }))}
            error={errors.projectType?.message}
            errorId="projectType-error"
            register={register("projectType")}
          />

          <ChoiceGroup
            legend={f.budget}
            options={BUDGETS.map((value) => ({ value, label: formatBudgetLabel(locale, value) }))}
            error={errors.budget?.message}
            errorId="budget-error"
            register={register("budget")}
          />
        </div>

        <div className="flex flex-col">
          <label htmlFor="message" className="mb-2 block text-sm font-medium">
            {f.message}
          </label>
          <textarea
            id="message"
            rows={9}
            placeholder={f.messagePlaceholder}
            aria-invalid={Boolean(errors.message)}
            aria-describedby={errors.message ? "message-error" : undefined}
            className={cn(inputClass, "min-h-56 flex-1 resize-y py-3.5")}
            {...register("message")}
          />
          <FieldError id="message-error" message={errors.message?.message} />

          {/* Honeypot: hidden from people, tempting for bots. */}
          <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>
              {f.honeypot}
              <input type="text" tabIndex={-1} autoComplete="off" {...register("company")} />
            </label>
          </div>

          <TurnstileWidget onToken={setTurnstileToken} handleRef={turnstile} />

          <Button
            type="submit"
            size="lg"
            icon="arrow"
            pending={isSubmitting}
            pendingLabel={f.sending}
            className="mt-6 w-full sm:ml-auto sm:w-auto"
          >
            {f.send}
          </Button>
        </div>
      </div>

      {result?.status === "sent" && (
        <div
          role="status"
          className="mt-6 flex gap-3 rounded-md border border-accent/40 bg-accent-soft p-4 text-sm"
        >
          <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
          <p>{f.success}</p>
        </div>
      )}
      {(result?.status === "error" || result?.status === "invalid") && (
        <div
          role="alert"
          className="mt-6 flex gap-3 rounded-md border border-danger/40 p-4 text-sm"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
          <p>
            {result.status === "error"
              ? result.message
              : f.checkFields}
            {stale && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="text-accent underline underline-offset-4"
                >
                  {dict.common.refreshPage}
                </button>
              </>
            )}
          </p>
        </div>
      )}
    </form>
  );
}
