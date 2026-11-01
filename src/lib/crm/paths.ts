import { crmOrigin, siteAdminOrigin } from "./host";

/**
 * Where the CRM screens live, per surface. The same components and pages are mounted twice during the migration:
 *  - "admin": the legacy mount inside the website admin (/admin/prospects, /admin/quotes, ...), unchanged until it is retired;
 *  - "crm":   the dedicated workspace on its own host (/prospects, /pipeline, /quotes, ...).
 * Components never write these literals themselves: they take the table for the surface they are rendered on
 * (`getPaths()` in server code, `useAppPaths()` in client components).
 */
export type AppKind = "admin" | "crm";

export type AppPaths = {
  kind: AppKind;
  home: string;
  login: string;

  prospects: string;
  prospectNew: string;
  prospectImport: string;
  prospectImportApi: string;
  prospectExport: string;
  /** Kanban board. */
  pipeline: string;
  prospect: (id: string) => string;
  prospectEdit: (id: string) => string;
  /** A tab of the prospect dossier (the CRM dossier has tabs; the legacy page ignores it). */
  prospectTab: (id: string, tab: string) => string;

  quotes: string;
  quoteNew: (prospectId?: string) => string;
  quoteTemplates: string;
  quote: (id: string) => string;
  quoteEdit: (id: string) => string;
  quotePdf: (id: string) => string;

  /** CRM settings (quote defaults + business details). */
  settings: string;
  /** Screens that only exist in the CRM workspace (null on the legacy mount). */
  followUps: string | null;
  clients: string | null;
  projects: string | null;

  /** Website-administration screens, always on the website admin (absolute from the CRM host). */
  website: {
    home: string;
    projectEdit: (id: string) => string;
    projectPreview: (id: string) => string;
    previews: string;
    previewEdit: (id: string) => string;
    integrations: string;
    zohoConnect: string;
  };
  /** The CRM, always an absolute URL (for "Open CRM" links). */
  crmHome: string;
};

function table(kind: AppKind): AppPaths {
  const crm = kind === "crm";
  const site = crm ? siteAdminOrigin() : "";
  const crmBase = crm ? "" : "/admin";
  const w = (path: string) => `${site}/admin${path}`;
  return {
    kind,
    home: crm ? "/" : "/admin",
    login: crm ? "/login" : "/admin/login",

    prospects: crm ? "/prospects" : "/admin/prospects",
    prospectNew: `${crmBase}/prospects/new`,
    prospectImport: `${crmBase}/prospects/import`,
    prospectImportApi: `${crmBase}/prospects/import/api`,
    prospectExport: `${crmBase}/prospects/export`,
    pipeline: crm ? "/pipeline" : "/admin/prospects/kanban",
    prospect: (id) => `${crmBase}/prospects/${id}`,
    prospectEdit: (id) => `${crmBase}/prospects/${id}/edit`,
    prospectTab: (id, tab) => `${crmBase}/prospects/${id}${tab !== "overview" ? `?tab=${tab}` : ""}`,

    quotes: `${crmBase}/quotes`,
    quoteNew: (prospectId) => `${crmBase}/quotes/new${prospectId ? `?prospect=${prospectId}` : ""}`,
    quoteTemplates: `${crmBase}/quotes/templates`,
    quote: (id) => `${crmBase}/quotes/${id}`,
    quoteEdit: (id) => `${crmBase}/quotes/${id}/edit`,
    quotePdf: (id) => `${crmBase}/quotes/${id}/pdf`,

    settings: crm ? "/settings" : "/admin/settings/quotes",
    followUps: crm ? "/follow-ups" : null,
    clients: crm ? "/clients" : null,
    projects: crm ? "/projects" : null,

    website: {
      home: w(""),
      projectEdit: (id) => w(`/projects/${id}/edit`),
      projectPreview: (id) => w(`/projects/${id}/preview`),
      previews: w("/previews"),
      previewEdit: (id) => w(`/previews/${id}/edit`),
      integrations: w("/settings/integrations"),
      zohoConnect: w("/settings/integrations/zoho/connect"),
    },
    crmHome: crmOrigin(),
  };
}

export const adminPaths: AppPaths = table("admin");
export const crmPaths: AppPaths = table("crm");

export function pathsFor(kind: AppKind): AppPaths {
  return kind === "crm" ? crmPaths : adminPaths;
}
