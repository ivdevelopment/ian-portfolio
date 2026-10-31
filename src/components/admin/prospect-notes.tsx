"use client";

import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { updateNotesAction } from "@/app/(admin)/admin/(panel)/prospects/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { adminInput } from "./ui";
import { useDirtySaveState } from "./use-dirty-save";

/** Notes are edited in place. Save is disabled until the text really differs from what is stored. */
export function ProspectNotes({ id, initial }: { id: string; initial: string }) {
  const router = useRouter();
  const { value, setValue, dirty, status, save } = useDirtySaveState<string>(initial, (notes) => updateNotesAction(id, notes), () => router.refresh());
  const saving = status.kind === "saving";

  return (
    <div>
      <label htmlFor="prospect-notes" className="sr-only">
        Notes
      </label>
      <textarea
        id="prospect-notes"
        rows={6}
        value={value}
        maxLength={10000}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Anything worth remembering about this prospect…"
        className={cn(adminInput, "py-2")}
      />
      <div className="mt-3 flex items-center justify-end gap-3">
        <div aria-live="polite" className="mr-auto min-h-5 text-sm">
          {status.kind === "error" && (
            <span role="alert" className="inline-flex items-center gap-2 text-danger">
              <AlertCircle aria-hidden className="size-4" /> {status.message}
            </span>
          )}
          {status.kind !== "error" && dirty && !saving && <span className="text-muted">Unsaved changes</span>}
        </div>
        <Button size="sm" icon="none" disabled={!dirty || saving} onClick={() => void save()}>
          {saving && <Loader2 aria-hidden className="size-4 animate-spin" />}
          {saving ? "Saving…" : "Save notes"}
        </Button>
      </div>
    </div>
  );
}
