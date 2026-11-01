import Link from "next/link";
import { QuoteSettingsForm } from "@/components/admin/quote-settings-form";
import { AdminPageHeader, Badge, Panel, formatDateTime } from "@/components/admin/ui";
import { ZohoPanel } from "@/components/admin/zoho-panel";
import { getPaths } from "@/lib/crm/server-paths";
import { getZohoConfig } from "@/lib/mail/zoho/config";
import { getConnection, getLastRun } from "@/lib/mail/zoho/service";
import { getQuoteSettings } from "@/lib/quotes/queries";

/** CRM settings: quote defaults and business details, services, and the mailbox. Website content settings live in the website admin. */
export default async function CrmSettingsPage() {
  const P = await getPaths();
  const [settings, config] = await Promise.all([getQuoteSettings(), Promise.resolve(getZohoConfig())]);
  const connection = config.enabled ? await getConnection() : null;
  const lastRun = connection ? await getLastRun(connection.id) : null;

  return (
    <>
      <AdminPageHeader title="Settings" description="How quotes look and read, and where your mail comes from." />

      <div className="space-y-4">
        <section aria-labelledby="quotes-h">
          <h2 id="quotes-h" className="mb-3 text-xs font-medium tracking-wider text-subtle uppercase">
            Quotes and business details
          </h2>
          <QuoteSettingsForm initial={settings} />
          <p className="mt-3 text-sm text-muted">
            Reusable lines for the quote builder are in{" "}
            <Link href={P.quoteTemplates} className="text-ink underline underline-offset-4">
              Services
            </Link>
            .
          </p>
        </section>

        <section aria-labelledby="mail-h" className="pt-4">
          <h2 id="mail-h" className="mb-3 text-xs font-medium tracking-wider text-subtle uppercase">
            Email
          </h2>
          <Panel
            title="Zoho Mail"
            description="Finds mail to and from your prospects so the CRM knows about it. Read-only: nothing is ever sent from here."
            actions={<Badge tone={connection ? (connection.status === "connected" ? "success" : "warn") : "neutral"}>{!config.enabled ? "Not enabled" : connection ? (connection.status === "connected" ? "Connected" : "Needs reconnect") : "Not connected"}</Badge>}
          >
            {!config.enabled ? (
              <p className="text-sm text-muted">{config.reason} The CRM works the same without it.</p>
            ) : (
              <>
                {connection && (
                  <dl className="mb-4 grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                    <dt className="text-muted">Account</dt>
                    <dd className="break-words">{connection.account_email}</dd>
                    <dt className="text-muted">Last sync</dt>
                    <dd>{connection.last_sync_at ? formatDateTime(connection.last_sync_at) : "Never"}</dd>
                  </dl>
                )}
                <ZohoPanel
                  manageHref={P.website.integrations}
                  connection={connection ? { account: connection.account_email, lastSync: connection.last_sync_at, needsReconnect: connection.status !== "connected" } : null}
                  lastRun={lastRun ? { mode: lastRun.mode, at: lastRun.started_at, checked: lastRun.messages_checked, matched: lastRun.messages_matched, stored: lastRun.messages_stored, errors: lastRun.errors } : null}
                />
              </>
            )}
          </Panel>
        </section>

        <section aria-labelledby="site-h" className="pt-4">
          <h2 id="site-h" className="mb-3 text-xs font-medium tracking-wider text-subtle uppercase">
            Website
          </h2>
          <p className="text-sm text-muted">
            Site content, SEO, pages, reviews, media and client preview hosting are managed in the{" "}
            <a href={P.website.home} className="text-ink underline underline-offset-4">
              website admin ↗
            </a>
            .
          </p>
        </section>
      </div>
    </>
  );
}
