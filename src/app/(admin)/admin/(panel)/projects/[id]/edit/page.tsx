import { notFound } from "next/navigation";
import { rowToEditorValues } from "@/lib/cms/editor";
import { loadProjectForAdmin } from "@/lib/cms/admin-queries";
import { AdminPageHeader } from "@/components/admin/ui";
import { ProjectEditor } from "@/components/admin/project-editor";
import { ProjectTranslationPanel } from "@/components/admin/translation-editors";
import { dutchDescriptor } from "@/i18n/known-dutch";
import { translationFor } from "@/i18n/localize-content";

export default async function EditProjectPage({
  params,
  searchParams,
}: PageProps<"/admin/projects/[id]/edit">) {
  const { id } = await params;
  const query = await searchParams;

  const row = await loadProjectForAdmin(id);
  if (!row) notFound();

  const notice = query.created ? "created" : query.duplicated ? "duplicated" : undefined;

  const saved = (translationFor(row.translations, "nl") ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const features = [...(row.project_features ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((f) => f.label);

  return (
    <>
      <AdminPageHeader title={row.title} description={`Editing /work/${row.slug}`} />
      <ProjectEditor mode="edit" initial={rowToEditorValues(row)} notice={notice} />
      <div className="mt-8">
        <ProjectTranslationPanel
          projectId={row.id}
          english={{
            title: row.title,
            subtitle: row.subtitle ?? "",
            shortDescription: row.short_description,
            description: row.description ?? "",
            category: row.category,
            features,
            captions: [...(row.project_media ?? [])]
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((m) => ({ id: m.id, alt: m.alt ?? "" })),
          }}
          initial={{
            title: text(saved.title),
            // Known short descriptors are pre-filled with their Dutch rendering (editable); long text is never machine-translated.
            subtitle: text(saved.subtitle) || (row.subtitle ? dutchDescriptor(row.subtitle) : ""),
            category: text(saved.category) || dutchDescriptor(row.category),
            shortDescription: text(saved.shortDescription),
            description: text(saved.description),
            features: Array.isArray(saved.features) ? saved.features.filter((f): f is string => typeof f === "string") : [],
            captions: (saved.captions ?? {}) as Record<string, string>,
          }}
        />
      </div>
    </>
  );
}
