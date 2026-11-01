import { QuoteSettingsForm } from "@/components/admin/quote-settings-form";
import { SettingsTabs } from "@/components/admin/settings-tabs";
import { AdminPageHeader } from "@/components/admin/ui";
import { getQuoteSettings } from "@/lib/quotes/queries";

export default async function QuoteSettingsPage() {
  const settings = await getQuoteSettings();
  return (
    <>
      <AdminPageHeader title="Settings" description="Defaults and business details for quotes." />
      <SettingsTabs active="quotes" />
      <QuoteSettingsForm initial={settings} />
    </>
  );
}
