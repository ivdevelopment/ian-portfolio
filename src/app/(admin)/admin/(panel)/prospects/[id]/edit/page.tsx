import Link from "next/link";
import { notFound } from "next/navigation";
import { ProspectForm } from "@/components/admin/prospect-form";
import { AdminPageHeader } from "@/components/admin/ui";
import { idSchema, prospectToFormValues } from "@/lib/schemas/prospect";
import { getProspect, listSectors } from "@/lib/prospects/queries";

export default async function EditProspectPage({ params }: PageProps<"/admin/prospects/[id]/edit">) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const [prospect, sectors] = await Promise.all([getProspect(id), listSectors()]);
  if (!prospect) notFound();

  return (
    <>
      <AdminPageHeader
        title={`Edit ${prospect.company_name}`}
        description="Every field of this prospect."
        actions={
          <Link href={`/admin/prospects/${prospect.id}`} className="text-sm text-muted hover:text-ink">
            Back to prospect
          </Link>
        }
      />
      <ProspectForm mode="edit" id={prospect.id} initial={prospectToFormValues(prospect)} sectors={sectors} />
    </>
  );
}
