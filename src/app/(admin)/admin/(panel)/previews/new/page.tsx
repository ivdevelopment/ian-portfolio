import { AdminPageHeader } from "@/components/admin/ui";
import { PreviewForm } from "@/components/admin/preview-form";
import { getPreviewConfig } from "@/lib/preview/config";

export default function NewPreviewPage() {
  const { baseDomain } = getPreviewConfig();
  return (
    <>
      <AdminPageHeader
        title="New client preview"
        description="Creates the preview record and an access code. DNS and the domain assignment are a separate step."
      />
      <PreviewForm mode="create" baseDomain={baseDomain} />
    </>
  );
}
