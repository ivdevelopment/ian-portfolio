"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { createAgentTokenAction, revokeAgentAction } from "@/crm/actions/prospecting";
import { NETWORK_ERROR } from "@/components/admin/use-action-runner";
import { Panel, adminInput } from "@/components/admin/ui";
import { AgentSummary } from "@/components/crm/agent-status";
import { Button } from "@/components/ui/button";
import type { AgentStatus } from "@/lib/prospecting/agent/service";
import { usePendingAction } from "@/lib/use-pending-action";

const STEPS = [
  { title: "Install Codex CLI", body: "npm install -g @openai/codex (or the Windows installer from the Codex documentation)." },
  { title: "Sign in with ChatGPT", body: "Run codex once and choose “Sign in with ChatGPT”. Codex keeps that sign-in itself; this CRM never sees it." },
  { title: "Install Ian Prospect Agent", body: "In the project folder: npm install, then npm run prospect-agent -- setup." },
  { title: "Connect this device", body: "Generate a connection token below and paste it when setup asks. It is shown once." },
];

/**
 * Local Prospect Agent in Settings: its status, the four setup steps, and the connection token. The token is created on the server, shown here
 * ONCE (this component holds it only until you leave or dismiss it) and stored server-side only as a hash. Generating a new token replaces the
 * old device; Revoke stops it at once.
 */
export function LocalAgentPanel({ agent, flagOn }: { agent: AgentStatus | null; flagOn: boolean }) {
  const router = useRouter();
  const nameId = useId();
  const { pending, run } = usePendingAction();
  const [name, setName] = useState(agent?.name ?? "Ian-PC");
  const [token, setToken] = useState<{ value: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = () =>
    run(async () => {
      setError(null);
      setCopied(false);
      try {
        const result = await createAgentTokenAction(name);
        if (!result.ok) return setError(result.error);
        setToken({ value: result.token, name: result.name });
        router.refresh();
      } catch {
        setError(NETWORK_ERROR);
      }
    });

  const revoke = () =>
    run(async () => {
      setError(null);
      try {
        const result = await revokeAgentAction();
        if (!result.ok) return setError(result.error);
        setConfirmRevoke(false);
        setToken(null);
        router.refresh();
      } catch {
        setError(NETWORK_ERROR);
      }
    });

  return (
    <Panel title="Local Prospect Agent" description="Runs the AI step on your own PC with Codex and your ChatGPT plan. The CRM never connects to your PC: the agent calls the CRM.">
      <AgentSummary agent={agent} />
      {!flagOn && <p className="mt-3 text-xs text-subtle">The finder is not switched on for this CRM yet, so searches cannot start even when the agent is connected.</p>}

      <ol className="mt-4 space-y-2 text-sm">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-line text-xs text-muted">
              {i + 1}
            </span>
            <span>
              <span className="font-medium">{s.title}.</span> <span className="text-muted">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={nameId} className="mb-1 block text-xs text-muted">
            Device name
          </label>
          <input id={nameId} className={`${adminInput} h-9 w-48`} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} disabled={pending} />
        </div>
        <Button size="sm" icon="none" pending={pending} pendingLabel="Generating…" disabled={pending || !name.trim()} onClick={() => void generate()}>
          {agent ? "Generate new token" : "Generate connection token"}
        </Button>
        {agent &&
          (confirmRevoke ? (
            <span className="flex items-center gap-2">
              <Button size="sm" variant="secondary" icon="none" className="text-danger" disabled={pending} onClick={() => void revoke()}>
                Confirm: revoke {agent.name}
              </Button>
              <button type="button" className="text-sm text-muted hover:text-ink" onClick={() => setConfirmRevoke(false)}>
                Keep
              </button>
            </span>
          ) : (
            <Button size="sm" variant="secondary" icon="none" disabled={pending} onClick={() => setConfirmRevoke(true)}>
              Revoke device
            </Button>
          ))}
      </div>
      {agent && <p className="mt-2 text-xs text-subtle">A new token replaces the current one: the old token stops working immediately.</p>}

      {token && (
        <div role="status" className="mt-4 rounded-md border border-line-strong bg-glass p-3 text-sm">
          <p className="font-medium">Connection token for {token.name}</p>
          <p className="mt-1 text-xs text-warn">Copy it now. It is shown only once and cannot be shown again; if you lose it, generate a new one.</p>
          <code data-testid="agent-token" className="mt-2 block break-all rounded bg-bg px-2 py-1.5 text-xs select-all">
            {token.value}
          </code>
          <div className="mt-2 flex items-center gap-3">
            <Button
              size="sm"
              variant="secondary"
              icon="none"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(token.value);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Copied" : "Copy token"}
            </Button>
            <button type="button" className="text-sm text-muted hover:text-ink" onClick={() => setToken(null)}>
              I have saved it, hide
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </Panel>
  );
}
