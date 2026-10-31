import { notFound } from "next/navigation";
import { AdminPageHeader, Panel, formatDate } from "@/components/admin/ui";
import { PreviewForm, type PreviewFormValues } from "@/components/admin/preview-form";
import { PreviewRowActions } from "@/components/admin/preview-row-actions";
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
          <p className="text-xs text-muted">
            {preview.access_count} {preview.access_count === 1 ? "visit" : "visits"}
            {preview.last_accessed_at ? ` · last opened ${formatDate(preview.last_accessed_at)}` : ""}
          </p>
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
