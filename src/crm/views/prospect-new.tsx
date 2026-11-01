import { ProspectForm } from "@/components/admin/prospect-form";
import { AdminPageHeader } from "@/components/admin/ui";
import { listSectors } from "@/lib/prospects/queries";

export default async function NewProspectPage() {
  const sectors = await listSectors();
  return (
    <>
      <AdminPageHeader title="New prospect" description="Add a company to the website-sales pipeline." />
      <ProspectForm mode="create" sectors={sectors} />
    </>
  );
}
