import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail } from "lucide-react";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { InquiryStatusSelect } from "@/components/admin/inquiry-status-select";
import { AdminPageHeader, Panel, formatDateTime } from "@/components/admin/ui";

export default async function InquiryDetailPage({
  params,
}: PageProps<"/admin/inquiries/[id]">) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const { data: inquiry, error } = await supabase
    .from("inquiries")
    .select("id, name, email, project_type, budget, message, status, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[admin] failed to load inquiry:", error.message);
    throw new Error("Inquiry unavailable");
  }
  if (!inquiry) notFound();

  const subject = encodeURIComponent(`Re: your project request`);

  return (
    <>
      <Link
        href="/admin/inquiries"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" /> All inquiries
      </Link>
      <AdminPageHeader
        title={inquiry.name}
        description={`Received ${formatDateTime(inquiry.created_at)}`}
        actions={<InquiryStatusSelect id={inquiry.id} status={inquiry.status} />}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <Panel title="Message">
          {/* Plain text only: React escapes it, whitespace is preserved. */}
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{inquiry.message}</p>
        </Panel>

        <Panel title="Details">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-subtle">Email</dt>
              <dd className="mt-0.5">
                <a
                  href={`mailto:${inquiry.email}?subject=${subject}`}
                  className="inline-flex items-center gap-1.5 break-all text-accent hover:underline"
                >
                  <Mail aria-hidden className="size-3.5 shrink-0" />
                  {inquiry.email}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Project type</dt>
              <dd className="mt-0.5">{inquiry.project_type}</dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Budget</dt>
              <dd className="mt-0.5">{inquiry.budget}</dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Last updated</dt>
              <dd className="mt-0.5">{formatDateTime(inquiry.updated_at)}</dd>
            </div>
          </dl>
        </Panel>
      </div>
    </>
  );
}
