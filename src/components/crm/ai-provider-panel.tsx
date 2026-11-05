import { Badge, Panel } from "@/components/admin/ui";
import { AgentSummary } from "@/components/crm/agent-status";
import type { ProviderStatus } from "@/lib/prospecting/config";
import type { AgentStatus } from "@/lib/prospecting/agent/service";

/**
 * Where the Prospect Finder's AI stands. Server-rendered and token-free: it only ever shows the provider flag's state and the plain reason.
 * There is no Connect button while no official integration exists, because a button that cannot work would pretend it does.
 */
export function AiProviderPanel({ status, compact = false, agent }: { status: ProviderStatus; compact?: boolean; agent?: AgentStatus | null }) {
  const tone = status.ready ? (status.synthetic ? "warn" : "success") : "neutral";
  return (
    <Panel title="AI prospecting" description="Finds and qualifies businesses for you to review. It never contacts anyone." actions={<Badge tone={tone}>{status.label}</Badge>}>
      <p className="text-sm text-muted">{status.message}</p>
      {status.queued && agent !== undefined && (
        <div className="mt-3 rounded-md border border-line bg-glass px-3 py-2">
          <AgentSummary agent={agent} />
        </div>
      )}
      {!compact && status.blocker && (
        <details className="mt-3 rounded-md border border-line bg-glass px-3 py-2 text-sm">
          <summary className="cursor-pointer select-none text-muted hover:text-ink">Connection info</summary>
          <div className="mt-2 space-y-2 text-xs text-muted">
            <p>{status.blocker}</p>
            <p>
              When it becomes available this uses the official <strong className="font-medium text-ink">Sign in with ChatGPT</strong> flow with explicit consent to use your ChatGPT plan. It does not need or get access to your ChatGPT conversations, memories or files, only permission to run the research requests. Tokens stay on the server.
            </p>
            <p>It never uses a normal OpenAI API key and never bills an API account. The provider is selected by one setting, <code className="rounded bg-glass px-1">AI_PROSPECTING_PROVIDER</code>, and stays off until it is switched on deliberately.</p>
          </div>
        </details>
      )}
    </Panel>
  );
}
