"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/admin/ui";
import { ONLINE_WITHIN_MS, type AgentStatus } from "@/lib/prospecting/agent/service";
import { failureMessage } from "@/lib/prospecting/agent/messages";

/** "5 seconds ago", "3 minutes ago". Rendered after mount so server and browser never disagree, and refreshed every few seconds. */
export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${m === 1 ? "minute" : "minutes"} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  return `${Math.round(h / 24)} days ago`;
}

function useNow(intervalMs = 5000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [intervalMs]);
  return now;
}

const CODEX_STATE: Record<NonNullable<AgentStatus["codexState"]>, string> = {
  ready: "Ready",
  not_installed: "Not installed",
  not_authenticated: "Not signed in with ChatGPT",
  error: "Needs attention",
};

/**
 * "Local AI Agent: Connected, Ian-PC, last heartbeat 5 seconds ago, Provider Codex / ChatGPT" or "Offline". Online is judged from the last
 * heartbeat (the agent sends one about every 20 seconds); after 90 seconds without one the agent is shown as offline.
 */
export function AgentSummary({ agent }: { agent: AgentStatus | null }) {
  const now = useNow();
  if (!agent) {
    return (
      <div className="text-sm">
        <p className="font-medium">Local AI Agent</p>
        <p className="mt-1 text-muted">Not set up. Add your computer in Settings, then start Ian Prospect Agent on it.</p>
      </div>
    );
  }
  const online = now === null ? agent.online : agent.lastSeenAt !== null && now - Date.parse(agent.lastSeenAt) < ONLINE_WITHIN_MS;
  const problem = failureMessage(agent.lastFailureKind);
  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">Local AI Agent</p>
        <Badge tone={online ? (agent.codexState === "ready" ? "success" : "warn") : "neutral"}>{online ? "Connected" : "Offline"}</Badge>
      </div>
      <dl className="mt-2 grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-1">
        <dt className="text-muted">Device</dt>
        <dd>{agent.name}</dd>
        <dt className="text-muted">Last heartbeat</dt>
        <dd suppressHydrationWarning>{now === null ? "…" : relativeTime(agent.lastSeenAt, now)}</dd>
        <dt className="text-muted">Provider</dt>
        <dd>Codex / ChatGPT</dd>
        {agent.codexVersion && (
          <>
            <dt className="text-muted">Codex</dt>
            <dd>{agent.codexVersion}</dd>
          </>
        )}
        {agent.codexState && online && (
          <>
            <dt className="text-muted">Codex status</dt>
            <dd>{CODEX_STATE[agent.codexState]}</dd>
          </>
        )}
      </dl>
      {!online && <p className="mt-2 text-muted">Start Ian Prospect Agent on your computer.</p>}
      {online && problem && agent.codexState !== "ready" && <p className="mt-2 text-muted">{problem}</p>}
    </div>
  );
}
