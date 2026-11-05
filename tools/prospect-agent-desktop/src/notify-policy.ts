import type { ServiceEvent } from "../../prospect-agent/src/service";

/**
 * Windows notifications are used sparingly: a finished search, a failed search, a rejected device. Never for heartbeats, never for the CRM
 * being briefly offline, never for a stop the person asked for. Text is fixed wording: no business names, no candidate details.
 */
export type NotificationSpec = { key: string; title: string; body: string; action: "open_crm" | "open_window" };

export function notificationFor(e: ServiceEvent): NotificationSpec | null {
  if (e.type === "run_finished") {
    if (e.status === "failed") return { key: "run_failed", title: "Prospect search failed", body: "Open the agent for details.", action: "open_window" };
    if (e.status === "completed" || e.status === "partial") {
      return e.candidates > 0
        ? { key: "run_done", title: "Prospect search completed", body: `${e.candidates} candidate${e.candidates === 1 ? "" : "s"} ready for review`, action: "open_crm" }
        : { key: "run_done", title: "Prospect search completed", body: "No new candidates this time.", action: "open_crm" };
    }
    return null;
  }
  if (e.type === "worker_stopped" && e.reason === "unauthorized") return { key: "rejected", title: "Agent disconnected", body: "The CRM rejected this device. Open the agent for details.", action: "open_window" };
  return null;
}

/** At most one notification per kind every 30 seconds, and one of any kind every 5 seconds. */
export class NotificationGate {
  private last = new Map<string, number>();
  private lastAny = 0;
  allow(key: string, now: number): boolean {
    if (now - this.lastAny < 5_000) return false;
    if (now - (this.last.get(key) ?? -Infinity) < 30_000) return false;
    this.last.set(key, now);
    this.lastAny = now;
    return true;
  }
}
