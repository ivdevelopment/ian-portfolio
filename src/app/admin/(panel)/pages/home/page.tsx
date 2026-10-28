import { loadHomeContent } from "@/lib/cms/site-admin";
import { AdminPageHeader } from "@/components/admin/ui";
import { HomeContentEditor } from "@/components/admin/content-editors";

export default async function AdminHomePageEditor() {
  const content = await loadHomeContent();
  return (
    <>
      <AdminPageHeader title="Home" description="Hero, stats, section intros and the call to action." />
      <HomeContentEditor initial={content} />
    </>
  );
}
