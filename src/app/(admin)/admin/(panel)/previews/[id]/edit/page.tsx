import { notFound } from "next/navigation";
import { AdminPageHeader, Panel, formatDate } from "@/components/admin/ui";
import { PreviewForm, type PreviewFormValues } from "@/components/admin/preview-form";
import { PreviewRowActions } from "@/components/admin/preview-row-actions";
import { formatBrusselsDateTime, summarizeAccess } from "@/lib/preview/access-activity";
import { loadPreview } from "@/lib/cms/preview-queries";
import { getPreviewConfig } from "@/lib/preview/config";

export default async function EditPreviewPage({ params }: PageProps<"/admin/previews/[id]/edit">) {
  const { id } = await params;
  const preview = await loadPreview(id);
  if (!preview) notFound();

  const { baseDomain } = getPreviewConfig();
  const url = `https://${preview.subdomain}.${baseDomain}`;
  const sessionTtlHours = ([24, 168, 336] as const).find((h) => h === preview.session_ttl_hours) ?? 168;

  const initial: PreviewFormValues = {
    clientName: preview.client_name,
    projectName: preview.project_name,
    subdomain: preview.subdomain,
    targetUrl: preview.target_url,
    expiryChoice: "keep",
    expiryDate: "",
    sessionTtlHours,
    notes: preview.notes ?? "",
    code: "",
  };

  return (
    <>
      <AdminPageHeader title={preview.client_name} description={`${preview.project_name} · ${url}`} />
      <div className="space-y-4">
        <Panel
          title="Access"
          description="Reset the code to lock everyone out and issue a new one. Disabling takes effect immediately."
          actions={<PreviewRowActions hideEdit preview={{ id: preview.id, clientName: preview.client_name, active: preview.active, url }} />}
        >
          <AccessActivity preview={preview} />
        </Panel>
        <PreviewForm
          mode="edit"
          id={preview.id}
          baseDomain={baseDomain}
          initial={initial}
          currentExpiryLabel={preview.expires_at ? formatDate(preview.expires_at) : "never"}
        />
      </div>
    </>
  );
}

function AccessActivity({ preview }: { preview: Awaited<ReturnType<typeof loadPreview>> & object }) {
  const access = summarizeAccess(preview);
  const rows: Array<[string, string]> = access.viewed
    ? [
        ["Status", "Viewed"],
        ["First viewed", formatBrusselsDateTime(access.first)],
        ["Last viewed", formatBrusselsDateTime(access.last)],
        ["Successful logins", String(access.count)],
      ]
    : [
        ["Status", "Never viewed"],
        ["Successful logins", "0"],
      ];
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium text-muted">Access activity</h3>
      <dl className="grid max-w-sm grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-subtle">Counts correct access-code unlocks only, not page views. Resetting the code keeps this history.</p>
    </div>
  );
}
