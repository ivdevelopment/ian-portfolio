"use client";

import { setStatusAction } from "@/app/(admin)/admin/(panel)/prospects/actions";
import { AdminSelect } from "@/components/admin/admin-select";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Spinner } from "@/components/ui/loading";
import { PROSPECT_STATUSES, STATUS_LABELS, type ProspectStatus } from "@/lib/prospects/constants";

const OPTIONS = PROSPECT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }));

/** "Change status" in the dossier header: the same server action as the pipeline, with its own pending and error state. */
export function ProspectStatusSelect({ id, status }: { id: string; status: ProspectStatus }) {
  const { run, pending, error } = useActionRunner();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="dossier-status" className="text-xs text-muted">
        Change status
      </label>
      <div className="w-48" aria-busy={pending}>
        <AdminSelect id="dossier-status" value={status} disabled={pending} options={OPTIONS} onChange={(next) => next !== status && run("status", () => setStatusAction(id, next))} />
      </div>
      <span role="status" className="inline-flex items-center gap-1.5 text-xs text-muted">
        {pending && (
          <>
            <Spinner className="size-3.5" /> Updating status…
          </>
        )}
      </span>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
