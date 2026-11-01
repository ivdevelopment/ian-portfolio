import Link from "next/link";
import { AdminPageHeader, Badge, EmptyState, formatDate } from "@/components/admin/ui";
import { formatBrusselsDateTime, summarizeAccess } from "@/lib/preview/access-activity";
import { PreviewRowActions } from "@/components/admin/preview-row-actions";
import { ButtonLink } from "@/components/ui/button";
import { listPreviews } from "@/lib/cms/preview-queries";
import { getPreviewConfig } from "@/lib/preview/config";
import { checkDomainStatus, type DomainStatus } from "@/lib/preview/domain-status";
import { previewState } from "@/lib/preview/expiry";

const STATE_BADGE = {
  active: { label: "Active", tone: "success" },
  disabled: { label: "Disabled", tone: "neutral" },
  expired: { label: "Expired", tone: "danger" },
} as const;

const DOMAIN_BADGE: Record<DomainStatus, { label: string; tone: "success" | "neutral" | "warn"; hint: string }> = {
  ready: { label: "Ready", tone: "success", hint: "The preview gateway answers on this hostname." },
  elsewhere: { label: "Not on gateway", tone: "warn", hint: "The hostname answers, but it is not served by the preview gateway yet." },
  pending: { label: "DNS pending", tone: "neutral", hint: "The hostname doesn't answer yet: add the domain to the gateway project and its DNS record." },
};

export default async function AdminPreviewsPage() {
  const previews = await listPreviews();
  const { baseDomain } = getPreviewConfig();
  const now = new Date();

  // Ask each hostname itself (short timeout, in parallel); never claims DNS works when it can't tell.
  const domains = await Promise.all(
    previews.map((p) => (previewState(p, now) === "active" ? checkDomainStatus(`${p.subdomain}.${baseDomain}`) : null)),
  );

  return (
    <>
      <AdminPageHeader
        title="Client Previews"
        description="Private, access-code protected previews of client websites on their own subdomain."
        actions={
          <ButtonLink href="/admin/previews/new" size="sm" icon="none">
            New preview
          </ButtonLink>
        }
      />

      {previews.length === 0 ? (
        <EmptyState>No client previews yet. Create the first one.</EmptyState>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-glass">
          {previews.map((p, i) => {
            const state = previewState(p, now);
            const badge = STATE_BADGE[state];
            const access = summarizeAccess(p);
            const domain = domains[i];
            const url = `https://${p.subdomain}.${baseDomain}`;
            let targetHost = "";
            try {
              targetHost = new URL(p.target_url).hostname;
            } catch {
              targetHost = "invalid target";
            }

            return (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 p-3 xl:flex-nowrap xl:p-4">
                <div className="min-w-48 flex-1 basis-48">
                  <Link href={`/admin/previews/${p.id}/edit`} className="truncate text-sm font-medium hover:text-accent">
                    {p.client_name}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-muted">{p.project_name}</p>
                  <p className="mt-0.5 truncate text-xs text-subtle">
                    {p.subdomain}.{baseDomain} → {targetHost}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 xl:w-60">
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                  {domain && (
                    <span title={DOMAIN_BADGE[domain].hint}>
                      <Badge tone={DOMAIN_BADGE[domain].tone}>{DOMAIN_BADGE[domain].label}</Badge>
                    </span>
                  )}
                  {state === "active" && domain === "pending" && (
                    <span className="text-xs text-subtle">Domain setup required</span>
                  )}
                </div>

                <dl className="grid grid-cols-4 gap-x-4 text-xs xl:w-96">
                  <div>
                    <dt className="text-subtle">Access</dt>
                    <dd className="mt-0.5">
                      <Badge tone={access.viewed ? "success" : "neutral"}>{access.label}</Badge>
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-subtle">Last viewed</dt>
                    <dd className="mt-0.5 text-muted">{access.viewed ? formatBrusselsDateTime(access.last) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-subtle">Views</dt>
                    <dd className="mt-0.5 text-muted" title="Successful access-code unlocks">{access.count}</dd>
                  </div>
                  <div className="col-span-4">
                    <dt className="sr-only">Expires</dt>
                    <dd className="text-subtle">Expires: {p.expires_at ? formatDate(p.expires_at) : "never"}</dd>
                  </div>
                </dl>

                <div className="ml-auto">
                  <PreviewRowActions preview={{ id: p.id, clientName: p.client_name, active: p.active, url }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
