"use client";

import { useAppPaths } from "@/lib/crm/paths-context";
import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EXPORT_FORMATS, type ExportFormat } from "@/lib/prospects/export";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";

type Scope = "all" | "filtered" | "selected";

const FORMAT_LABELS: Record<ExportFormat, string> = { csv: "CSV", xlsx: "Excel (XLSX)", json: "JSON" };
const FORMAT_HINTS: Record<ExportFormat, string> = {
  csv: "One row per prospect. Activity history is not included.",
  xlsx: "A Prospects sheet and an Activities sheet, with real dates and euro amounts.",
  json: "Structured data, optionally with each prospect's activities.",
};

/** Asks the server (admin only, POST) to generate the file, then saves it. No export URL is ever public. */
export function ExportDialog({
  open,
  onClose,
  query,
  selectedIds,
  filtersActive,
}: {
  open: boolean;
  onClose: () => void;
  /** The list's current query string. */
  query: string;
  selectedIds: string[];
  filtersActive: boolean;
}) {
  const P = useAppPaths();
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [scope, setScope] = useState<Scope>(selectedIds.length > 0 ? "selected" : filtersActive ? "filtered" : "all");
  const [withActivities, setWithActivities] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scopes: Array<{ value: Scope; label: string; disabled?: boolean }> = [
    { value: "all", label: "All prospects" },
    { value: "filtered", label: "Current filtered results", disabled: !filtersActive },
    { value: "selected", label: `Selected prospects (${selectedIds.length})`, disabled: selectedIds.length === 0 },
  ];

  const run = async () => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(P.prospectExport, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          format,
          scope,
          query,
          ids: scope === "selected" ? selectedIds : undefined,
          includeActivities: format === "csv" ? false : withActivities,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "The export failed.");
      }
      const blob = await response.blob();
      const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? `prospects.${format}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The export failed.");
    } finally {
      setPending(false);
    }
  };

  return (
    <ConfirmDialog open={open} title="Export prospects" confirmLabel="Download" pendingLabel="Preparing export…" tone="primary" pending={pending} error={error} onConfirm={() => void run()} onClose={onClose}>
      <fieldset className="mt-1 space-y-2">
        <legend className="mb-1 text-xs font-medium text-muted">Format</legend>
        {EXPORT_FORMATS.map((f) => (
          <label key={f} className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="radio" name="export-format" className="mt-1 accent-[var(--color-accent-strong)]" checked={format === f} onChange={() => setFormat(f)} />
            <span>
              <span className="text-ink">{FORMAT_LABELS[f]}</span>
              <span className="block text-xs text-subtle">{FORMAT_HINTS[f]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="mt-4 space-y-2">
        <legend className="mb-1 text-xs font-medium text-muted">Which prospects</legend>
        {scopes.map((s) => (
          <label key={s.value} className={cn("flex items-center gap-2 text-sm", s.disabled ? "opacity-40" : "cursor-pointer")}>
            <input type="radio" name="export-scope" disabled={s.disabled} className="accent-[var(--color-accent-strong)]" checked={scope === s.value} onChange={() => setScope(s.value)} />
            {s.label}
          </label>
        ))}
      </fieldset>
      {format !== "csv" && (
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--color-accent-strong)]" checked={withActivities} onChange={(e) => setWithActivities(e.target.checked)} />
          Include activity history
        </label>
      )}
    </ConfirmDialog>
  );
}

export function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" icon="none" onClick={onClick}>
      <Download aria-hidden className="size-4" /> Export
    </Button>
  );
}
