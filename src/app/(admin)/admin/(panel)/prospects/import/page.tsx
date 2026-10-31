import { ProspectImport } from "@/components/admin/prospect-import";
import { AdminPageHeader } from "@/components/admin/ui";

export default function ImportProspectsPage() {
  return (
    <>
      <AdminPageHeader title="Import prospects" description="Bring in prospects from a CSV or Excel file. You review everything before it is saved." />
      <ProspectImport />
    </>
  );
}
