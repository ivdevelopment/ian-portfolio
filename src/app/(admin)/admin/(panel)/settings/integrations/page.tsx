import { SettingsTabs } from "@/components/admin/settings-tabs";
import { Badge, AdminPageHeader, Panel, formatDateTime } from "@/components/admin/ui";
import { ZohoPanel } from "@/components/admin/zoho-panel";
import { getZohoConfig } from "@/lib/mail/zoho/config";
import { getConnection, getLastRun } from "@/lib/mail/zoho/service";

const ERRORS: Record<string, string> = {
  not_enabled: "Zoho Mail is not enabled on this deployment.",
  denied: "Zoho access was not granted.",
  no_code: "Zoho did not return an authorisation code.",
  auth: "Zoho refused the authorisation. Check the client credentials and the account.",
  bad_response: "Zoho returned an unexpected answer.",
  network: "Zoho could not be reached.",
  failed: "The connection could not be completed.",
};
const stateError = (e: string) => (e.startsWith("state_") ? "The sign-in attempt could not be verified (expired or from another session). Start again." : (ERRORS[e] ?? "The connection could not be completed."));

export default async function IntegrationsPage({ searchParams }: PageProps<"/admin/settings/integrations">) {
  const query = await searchParams;
  const config = getZohoConfig();
  // With the integration off, nothing about mail is read from the database: the CRM never depends on it.
  const connection = config.enabled ? await getConnection() : null;
  const lastRun = connection ? await getLastRun(connection.id) : null;
  const error = typeof query.zoho_error === "string" ? query.zoho_error : null;

  return (
    <>
      <AdminPageHeader title="Settings" description="Connections to other services." />
      <SettingsTabs active="integrations" />
      <Panel
        title="Zoho Mail"
        description="Finds mail to and from your prospects so the CRM knows about it, even when you write from Zoho. Read-only."
        actions={<Badge tone={connection ? (connection.status === "connected" ? "success" : "warn") : "neutral"}>{!config.enabled ? "Not enabled" : connection ? (connection.status === "connected" ? "Connected" : "Needs reconnect") : "Not connected"}</Badge>}
      >
        {query.zoho === "connected" && <p className="mb-3 text-sm text-emerald-200">Zoho Mail connected.</p>}
        {error && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {stateError(error)}
          </p>
        )}
        {!config.enabled ? (
          <p className="text-sm text-muted">{config.reason} The CRM works the same without it.</p>
        ) : (
          <>
            {connection && (
              <dl className="mb-4 grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                <dt className="text-muted">Account</dt>
                <dd>{connection.account_email}</dd>
                <dt className="text-muted">Data center</dt>
                <dd>{connection.data_center}</dd>
                <dt className="text-muted">Permissions</dt>
                <dd className="break-words">{connection.scopes}</dd>
                <dt className="text-muted">Last sync</dt>
                <dd>{connection.last_sync_at ? formatDateTime(connection.last_sync_at) : "Never"}</dd>
              </dl>
            )}
            <ZohoPanel
              connection={connection ? { account: connection.account_email, lastSync: connection.last_sync_at, needsReconnect: connection.status !== "connected" } : null}
              lastRun={lastRun ? { mode: lastRun.mode, at: lastRun.started_at, checked: lastRun.messages_checked, matched: lastRun.messages_matched, stored: lastRun.messages_stored, errors: lastRun.errors } : null}
            />
          </>
        )}
      </Panel>
    </>
  );
}
