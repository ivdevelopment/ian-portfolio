import { Suspense } from "react";
import { connection } from "next/server";
import { AdminPageHeader } from "@/components/admin/ui";
import { AiProviderPanel } from "@/components/crm/ai-provider-panel";
import { ProspectFinder } from "@/components/crm/prospect-finder";
import { TableSkeleton } from "@/components/ui/loading";
import { requireAdmin } from "@/lib/auth";
import { getAgentStatus } from "@/lib/prospecting/agent/service";
import { getProviderStatus, providerFlag } from "@/lib/prospecting/config";
import { isActiveStatus, listCandidates, listRuns } from "@/lib/prospecting/service";

/** The discovery workspace: provider status, the search form, live progress, candidates to review and the history of searches. */
export default function ProspectingPage() {
  return (
    <>
      <AdminPageHeader title="Find prospects" description="Search public sources for businesses that are likely to need your services, then review them before anything reaches the CRM." />
      <Suspense fallback={<TableSkeleton rows={4} filters={false} />}>
        <Workspace />
      </Suspense>
    </>
  );
}

async function Workspace() {
  await connection();
  const { supabase } = await requireAdmin();
  const agent = providerFlag() === "local_codex" ? await getAgentStatus(supabase) : null;
  const status = getProviderStatus(process.env, agent);
  const runs = await listRuns(supabase, 8);
  const active = runs.find((r) => isActiveStatus(r.status));
  const [candidates, duplicates] = await Promise.all([
    listCandidates(supabase, { status: "pending" }, 100),
    runs[0] ? listCandidates(supabase, { status: "rejected_duplicate", runId: runs[0].id }, 20) : Promise.resolve([]),
  ]);
  return (
    <div className="space-y-6">
      {(!status.ready || status.queued) && <AiProviderPanel status={status} agent={status.queued ? agent : undefined} compact={status.queued} />}
      <ProspectFinder ready={status.ready} runs={runs} candidates={candidates} duplicates={duplicates} activeRunId={active?.id ?? null} />
      {status.ready && status.synthetic && <AiProviderPanel status={status} compact />}
    </div>
  );
}
