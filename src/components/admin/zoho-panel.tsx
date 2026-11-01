"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { zohoDisconnectAction, zohoDryRunAction, zohoSyncNowAction } from "@/app/(admin)/admin/(panel)/settings/integrations/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import type { SyncReport } from "@/lib/mail/zoho/sync";
import { ConfirmDialog } from "./confirm-dialog";

export type PanelConnection = { account: string; lastSync: string | null; needsReconnect: boolean } | null;

/** Connect / check / sync / disconnect for Zoho Mail. Tokens never reach the browser: every button calls the server. */
export function ZohoPanel({ connection, lastRun }: { connection: PanelConnection; lastRun: Pick<SyncReport, "checked" | "matched" | "stored" | "errors"> & { mode: string; at: string } | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"dry" | "sync" | null>(null);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const run = (kind: "dry" | "sync") => {
    setBusy(kind);
    setError(null);
    startTransition(async () => {
      const result = await (kind === "dry" ? zohoDryRunAction() : zohoSyncNowAction());
      setBusy(null);
      if (!result.ok) return setError(result.error);
      setReport(result.report ?? null);
      router.refresh();
    });
  };

  if (!connection) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <ButtonLink href="/admin/settings/integrations/zoho/connect" size="sm" icon="none">
          Connect Zoho Mail
        </ButtonLink>
        <p className="text-xs text-subtle">Read-only access to find mail to and from your prospects. Nothing is synced until you press Sync now.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" icon="none" disabled={pending} onClick={() => run("dry")}>
          {busy === "dry" && <Loader2 aria-hidden className="size-4 animate-spin" />}
          Check mailbox (dry run)
        </Button>
        <Button size="sm" icon="none" disabled={pending || connection.needsReconnect} onClick={() => run("sync")}>
          {busy === "sync" && <Loader2 aria-hidden className="size-4 animate-spin" />}
          Sync now
        </Button>
        <ButtonLink href="/admin/settings/integrations/zoho/connect" size="sm" variant="secondary" icon="none">
          Reconnect
        </ButtonLink>
        <Button size="sm" variant="secondary" icon="none" className="text-danger" disabled={pending} onClick={() => setConfirmDisconnect(true)}>
          Disconnect
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      {report && (
        <div className="mt-4 rounded-card border border-line p-3 text-sm" role="status">
          <p className="font-medium">{report.mode === "dry_run" ? "Dry run (nothing stored)" : "Sync finished"}</p>
          <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Messages scanned" value={report.checked} />
            <Stat label="Unique messages" value={report.unique} />
            <Stat label="Outgoing" value={report.outgoing} />
            <Stat label="Incoming" value={report.incoming} />
            <Stat label="Matched to a prospect" value={report.matched} />
            <Stat label="Unmatched" value={report.unmatched} />
            <Stat label="Ambiguous (not linked)" value={report.ambiguous} />
            <Stat label="Duplicate provider ids" value={report.duplicateIds} />
            <Stat label="Already stored" value={report.alreadyStored} />
            <Stat label={report.mode === "dry_run" ? "Would store" : "Stored"} value={report.mode === "dry_run" ? report.matched - report.alreadyStored : report.stored} />
            <Stat label="Rate-limit retries" value={report.rateLimitRetries} />
            <Stat label="Unusable entries" value={report.skippedUnusable} />
          </dl>
          {Object.keys(report.outgoingByFolder).length > 0 && (
            <p className="mt-3 text-xs text-muted">
              Matched outgoing mail by folder: {Object.entries(report.outgoingByFolder).map(([f, n]) => `${f} ${n}`).join(" · ")}
            </p>
          )}
          {report.unmatchedDetail && report.unmatchedDetail.length > 0 && (
            <div className="mt-3 text-xs text-muted">
              <p className="font-medium text-ink">Unmatched messages ({report.unmatchedDetail.length}), shown for review and not stored</p>
              <ul data-testid="unmatched" className="mt-1 list-disc space-y-0.5 pl-5">
                {report.unmatchedDetail.map((m, i) => (
                  <li key={i}>
                    {m.direction} · {m.sent_at.slice(0, 10)} · from {m.from} → {[...m.to, ...m.cc].join(", ") || "—"} · {m.subject ?? "(no subject)"}
                    {m.candidate ? ` · candidate: ${m.candidate.company} (${m.candidate.reason}${m.candidate.hasEmail ? "; already has an email" : "; no email yet"})` : " · no candidate"}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.capabilities && (
            <div className="mt-3 text-xs text-muted">
              <p className="font-medium text-ink">Read-only capability checks</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>Result pages: {report.pages.join(", ") || "none"}</li>
                <li>Pagination: {report.capabilities.pagination.ok ? "ok" : "problem"} ({report.capabilities.pagination.note})</li>
                <li>Message read: {report.capabilities.messageRead.ok ? `ok (fields: ${report.capabilities.messageRead.fields.join(", ")})` : report.capabilities.messageRead.error}{report.capabilities.messageRead.folderName ? ` · folder: ${report.capabilities.messageRead.folderName}` : ""}</li>
                <li>Folder names: {report.capabilities.folders.ok ? Object.entries(report.capabilities.folders.names).map(([id, n]) => `${id}=${n}`).join(", ") : `not available (${report.capabilities.folders.error})`}</li>
              </ul>
            </div>
          )}
          {report.watched.length > 0 && (
            <div className="mt-3 text-xs text-muted">
              <p className="font-medium text-ink">Notes saying “Getoond in Zoho Drafts” (notes are never changed)</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {report.watched.map((w) => (
                  <li key={w.prospect_id}>
                    {w.company ?? w.prospect_id}: {w.outgoing} outgoing, {w.incoming} incoming{w.folders.length ? ` · folders: ${w.folders.join(", ")}` : ""}{w.delivery !== undefined ? ` · mailDeliveryStatus: ${w.delivery ?? "n/a"}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-danger">
              {report.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmDisconnect}
        title="Disconnect Zoho Mail?"
        confirmLabel="Disconnect"
        pending={pending}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={() =>
          startTransition(async () => {
            const result = await zohoDisconnectAction();
            setConfirmDisconnect(false);
            if (!result.ok) return setError(result.error);
            router.refresh();
          })
        }
      >
        Zoho is told to revoke access, the saved token is deleted, and the mail copied into the CRM is removed. Your Zoho mailbox itself is not touched.
      </ConfirmDialog>
      {lastRun && !report && (
        <p className="mt-3 text-xs text-subtle">
          Last run: {lastRun.mode === "dry_run" ? "dry run" : "sync"} · {lastRun.checked} checked · {lastRun.matched} linked · {lastRun.errors.length} errors
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dd className="text-lg font-medium tabular-nums">{value}</dd>
      <dt className="text-xs text-muted">{label}</dt>
    </div>
  );
}
