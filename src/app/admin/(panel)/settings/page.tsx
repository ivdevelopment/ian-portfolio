import { loadSettings } from "@/lib/cms/site-admin";
import { AdminPageHeader } from "@/components/admin/ui";
import { SettingsEditor } from "@/components/admin/content-editors";

export default async function AdminSettingsPage() {
  const settings = await loadSettings();
  return (
    <>
      <AdminPageHeader title="Settings" description="Site-wide details, social links and SEO defaults." />
      <SettingsEditor initial={settings} />
    </>
  );
}
