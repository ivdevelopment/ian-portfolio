"use client";

import { useAppPaths } from "@/lib/crm/paths-context";
import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { IMPORT_FIELDS, type ColumnMapping, type ImportFieldKey } from "@/lib/prospects/import";
import type { CommitResult, ValidationReport } from "@/lib/prospects/import-service";
import { cn } from "@/lib/utils";
import { AdminSelect } from "./admin-select";
import { Badge, Panel, adminInput } from "./ui";

type Parsed = { fileName: string; headers: string[]; sample: string[][]; rowCount: number; mapping: ColumnMapping };
const NONE = "__none";

/**
 * Upload → parse → map columns → validate (errors + likely duplicates) → confirm. The file is re-sent with each
 * step and nothing is stored in between. Duplicates are skipped unless you tick "Import anyway": never merged.
 */
export function ProspectImport() {
  const P = useAppPaths();
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [allowDuplicates, setAllowDuplicates] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<CommitResult | null>(null);
  const [busy, setBusy] = useState<"parse" | "validate" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call<T>(step: "parse" | "validate" | "commit", extra: Record<string, string> = {}): Promise<T | null> {
    if (!file) return null;
    setBusy(step);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("step", step);
      for (const [k, v] of Object.entries(extra)) form.set(k, v);
      const response = await fetch(P.prospectImportApi, { method: "POST", body: form });
      const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.error ?? "That step failed. Please try again.");
      return body;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That step failed.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  const reset = () => {
    setFile(null);
    setParsed(null);
    setReport(null);
    setResult(null);
    setAllowDuplicates(new Set());
    setError(null);
  };

  const parse = async () => {
    const out = await call<Parsed>("parse");
    if (!out) return;
    setParsed(out);
    setMapping(out.mapping);
    setReport(null);
  };

  const validate = async () => {
    const out = await call<ValidationReport>("validate", { mapping: JSON.stringify(mapping) });
    if (!out) return;
    setReport(out);
    setAllowDuplicates(new Set());
  };

  const commit = async () => {
    const out = await call<CommitResult>("commit", { mapping: JSON.stringify(mapping), importDuplicates: JSON.stringify([...allowDuplicates]) });
    if (out) setResult(out);
  };

  const importable = report ? report.rows.filter((r) => r.errors.length === 0 && (!r.duplicate || allowDuplicates.has(r.row))).length : 0;
  const companyMapped = mapping.companyName !== undefined && mapping.companyName !== null;
  const headerOptions = [{ value: NONE, label: "— Not mapped —" }, ...(parsed?.headers.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` })) ?? [])];

  if (result) {
    return (
      <Panel title="Import finished">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[
            ["Rows parsed", result.parsed],
            ["Imported", result.imported],
            ["Skipped", result.skipped],
            ["Likely duplicates", result.duplicates],
          ].map(([label, value]) => (
            <div key={label} className="rounded-card border border-line p-3">
              <dd className="text-xl font-medium tabular-nums">{value}</dd>
              <dt className="text-xs text-muted">{label}</dt>
            </div>
          ))}
        </dl>
        {result.warnings.length > 0 && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-muted">{result.warnings.length} notes</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        )}
        <div className="mt-5 flex gap-2">
          <ButtonLink href={P.prospects} size="sm" icon="none">
            View prospects
          </ButtonLink>
          <Button size="sm" variant="secondary" icon="none" onClick={reset}>
            Import another file
          </Button>
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel title="1. Upload" description="CSV or Excel (.xlsx), up to 5 MB and 2,000 rows. The first row must hold the column names.">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-label="File to import"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setParsed(null);
              setReport(null);
              setError(null);
            }}
            className={cn(adminInput, "h-10 max-w-sm py-1.5 file:mr-3 file:rounded-full file:border-0 file:bg-glass-strong file:px-3 file:py-1 file:text-sm file:text-ink")}
          />
          <Button size="sm" icon="none" disabled={!file || busy !== null} pending={busy === "parse"} pendingLabel="Reading file…" onClick={() => void parse()}>
            <FileUp aria-hidden className="size-4" />
            Read file
          </Button>
        </div>
        <p className="mt-3 text-xs text-subtle">
          Dutch or English column names are recognised (Bedrijf, Sector, Stad, E-mailadres, Status, Prioriteit, Eerste contact, Volgende opvolging, Notities…). Dates may be 29 okt 2026, 29/10/2026 or 2026-10-29.
        </p>
      </Panel>

      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-card border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          <AlertTriangle aria-hidden className="size-4 shrink-0" /> {error}
        </p>
      )}

      {parsed && (
        <Panel title="2. Map columns" description={`${parsed.fileName}: ${parsed.rowCount} rows. Check how each column is used.`}>
          <div className="grid gap-3 sm:grid-cols-2">
            {IMPORT_FIELDS.map((f) => {
              const current = mapping[f.key as ImportFieldKey];
              return (
                <div key={f.key}>
                  <label htmlFor={`map-${f.key}`} className="mb-1.5 block text-xs font-medium text-muted">
                    {f.label}
                    {"required" in f && f.required ? " *" : ""}
                  </label>
                  <AdminSelect
                    id={`map-${f.key}`}
                    value={current === null || current === undefined ? NONE : String(current)}
                    onChange={(v) => {
                      setMapping((m) => ({ ...m, [f.key]: v === NONE ? null : Number(v) }));
                      setReport(null);
                    }}
                    options={headerOptions}
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-4 overflow-x-auto rounded-card border border-line">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-line text-subtle">
                <tr>
                  {parsed.headers.map((h, i) => (
                    <th key={i} className="whitespace-nowrap px-3 py-2 font-normal">
                      {h || `Column ${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-muted">
                {parsed.sample.map((row, r) => (
                  <tr key={r}>
                    {parsed.headers.map((_, c) => (
                      <td key={c} className="max-w-48 truncate px-3 py-1.5">
                        {row[c] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <Button size="sm" icon="none" disabled={!companyMapped || busy !== null} pending={busy === "validate"} pendingLabel="Checking rows…" onClick={() => void validate()}>
              Check rows
            </Button>
            {!companyMapped && <span className="ml-3 text-xs text-danger">Map the Company column first.</span>}
          </div>
        </Panel>
      )}

      {report && (
        <Panel title="3. Review and import">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              ["Rows parsed", report.parsed],
              ["Ready", report.valid],
              ["With errors", report.invalid],
              ["Likely duplicates", report.duplicates],
            ].map(([label, value]) => (
              <div key={label} className="rounded-card border border-line p-3">
                <dd className="text-xl font-medium tabular-nums">{value}</dd>
                <dt className="text-xs text-muted">{label}</dt>
              </div>
            ))}
          </dl>

          {report.rows.some((r) => r.errors.length > 0 || r.warnings.length > 0 || r.duplicate) ? (
            <ul className="mt-4 max-h-96 divide-y divide-line overflow-auto rounded-card border border-line text-sm">
              {report.rows
                .filter((r) => r.errors.length > 0 || r.warnings.length > 0 || r.duplicate)
                .map((r) => (
                  <li key={r.row} className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-subtle">Row {r.row}</span>
                      <span className="font-medium">{r.company || "(no company)"}</span>
                      {r.errors.length > 0 && <Badge tone="danger">Will be skipped</Badge>}
                      {r.duplicate && <Badge tone="warn">Likely duplicate</Badge>}
                    </div>
                    {r.errors.map((e, i) => (
                      <p key={i} className="mt-1 text-xs text-danger">
                        {e}
                      </p>
                    ))}
                    {r.warnings.map((w, i) => (
                      <p key={i} className="mt-1 text-xs text-amber-200">
                        {w}
                      </p>
                    ))}
                    {r.duplicate && (
                      <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-muted">
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--color-accent-strong)]"
                          checked={allowDuplicates.has(r.row)}
                          onChange={(e) =>
                            setAllowDuplicates((s) => {
                              const next = new Set(s);
                              if (e.target.checked) next.add(r.row);
                              else next.delete(r.row);
                              return next;
                            })
                          }
                        />
                        Same {r.duplicate.reasons.join(" + ")} as {r.duplicate.label}
                        {r.duplicate.kind === "existing" ? " (already in your CRM)" : ""}. Import anyway
                      </label>
                    )}
                  </li>
                ))}
            </ul>
          ) : (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted">
              <CheckCircle2 aria-hidden className="size-4 text-accent" /> Every row looks good.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button size="sm" icon="none" disabled={importable === 0 || busy !== null} pending={busy === "commit"} pendingLabel={`Importing ${importable}…`} onClick={() => void commit()}>
              Import {importable} {importable === 1 ? "prospect" : "prospects"}
            </Button>
            <p className="text-xs text-subtle">Rows with errors and unticked duplicates are skipped. Nothing is merged or overwritten.</p>
          </div>
        </Panel>
      )}

      <p className="text-xs text-subtle">
        Imports are recorded (rows parsed, imported, skipped, duplicates). <Link href={P.prospects} className="text-accent hover:underline">Back to prospects</Link>
      </p>
    </div>
  );
}
