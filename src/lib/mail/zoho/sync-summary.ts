import type { SyncReport } from "./sync";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The compact result of a real Sync, in the words the CRM uses everywhere:
 *   New emails        = messages stored by this run
 *   Prospect candidates = outgoing recipients nobody has yet (waiting for a decision)
 *   Prospects created = always none: a sync never creates a prospect, only "Add as prospect" does
 */
export function syncSummary(report: Pick<SyncReport, "stored" | "candidates" | "candidatesPending" | "errors">): { title: string; parts: string[]; pending: number } {
  return {
    title: report.errors.length > 0 ? "Sync finished with errors" : "Sync complete",
    parts: [plural(report.stored, "new email", "new emails"), plural(report.candidates, "new prospect candidate", "new prospect candidates"), plural(report.errors.length, "error", "errors")],
    pending: report.candidatesPending ?? report.candidates,
  };
}
