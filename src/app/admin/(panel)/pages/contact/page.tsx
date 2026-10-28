import { loadContactContent, loadSettings } from "@/lib/cms/site-admin";
import { AdminPageHeader } from "@/components/admin/ui";
import { ContactContentEditor } from "@/components/admin/content-editors";

export default async function AdminContactPageEditor() {
  const [content, settings] = await Promise.all([loadContactContent(), loadSettings()]);
  return (
    <>
      <AdminPageHeader title="Contact" description="The header and public contact details. The enquiry form itself is unchanged." />
      <ContactContentEditor initial={content} settingsEmail={settings.contactEmail} />
    </>
  );
}
