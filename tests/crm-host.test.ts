import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decideCrmRoute, isCrmLoginPath } from "@/lib/crm/auth-routes";
import { CRM_APP_HEADER, crmHostname, crmOrigin, isCrmHost, isCrmTreePath, siteAdminOrigin, toCrmTreePath } from "@/lib/crm/host";
import { adminPaths, crmPaths, pathsFor } from "@/lib/crm/paths";
import { CRM_NAV, isActiveCrmPath } from "@/crm/nav";
import { RESERVED_SUBDOMAINS, validateSubdomain } from "@/lib/preview/subdomain";
import { parsePreviewHost } from "@/lib/preview/hostname";
import { proxy } from "@/proxy";

const call = (url: string, host = new URL(url).host, cookie?: string) => proxy(new NextRequest(url, { headers: { host, ...(cookie ? { cookie } : {}) } }));
const rewriteTarget = (res: Response) => res.headers.get("x-middleware-rewrite");

afterEach(() => vi.unstubAllEnvs());

describe("CRM host detection", () => {
  it("accepts exactly the configured CRM hostname, with or without a port", () => {
    expect(isCrmHost("crm.ianverlinden.com")).toBe(true);
    expect(isCrmHost("CRM.IANVERLINDEN.COM")).toBe(true);
    expect(isCrmHost("crm.ianverlinden.com:443")).toBe(true);
  });

  it("rejects the apex, www, previews, look-alikes and malformed hosts", () => {
    for (const host of ["ianverlinden.com", "www.ianverlinden.com", "geertkips.ianverlinden.com", "crm.ianverlinden.com.evil.com", "evilcrm.ianverlinden.com", "crm.evil.com", "a.crm.ianverlinden.com", "crm.ianverlinden.com@evil.com", "crm.ianverlinden.com/x", "", "crm.ianverlinden.com:abc"]) {
      expect(isCrmHost(host), host).toBe(false);
    }
    expect(isCrmHost(null)).toBe(false);
    expect(isCrmHost(undefined)).toBe(false);
  });

  it("allows crm.localhost only outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isCrmHost("crm.localhost:3000")).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(isCrmHost("crm.localhost:3000")).toBe(false);
  });

  it("honours CRM_HOST (validated) and falls back to the default", () => {
    expect(crmHostname({ CRM_HOST: "crm.example.test" })).toBe("crm.example.test");
    expect(crmHostname({ CRM_HOST: "not a host!" })).toBe("crm.ianverlinden.com");
    expect(crmHostname({})).toBe("crm.ianverlinden.com");
    expect(isCrmHost("crm.example.test", { CRM_HOST: "crm.example.test" })).toBe(true);
  });

  it("maps visible URLs to the internal tree and recognises the tree", () => {
    expect(toCrmTreePath("/")).toBe("/crm");
    expect(toCrmTreePath("/prospects/1")).toBe("/crm/prospects/1");
    expect(isCrmTreePath("/crm")).toBe(true);
    expect(isCrmTreePath("/crm/quotes")).toBe(true);
    expect(isCrmTreePath("/crmx")).toBe(false);
    expect(isCrmTreePath("/work/crm")).toBe(false);
  });

  it("knows the canonical origins for cross-links", () => {
    expect(crmOrigin({})).toBe("https://crm.ianverlinden.com");
    expect(siteAdminOrigin({})).toBe("https://ianverlinden.com");
    expect(siteAdminOrigin({ NEXT_PUBLIC_SITE_URL: "https://ianverlinden.com/" })).toBe("https://ianverlinden.com");
  });
});

describe("the crm subdomain can never be a client preview", () => {
  it("is reserved, so no preview can be created under it and the gateway never treats it as one", () => {
    expect(RESERVED_SUBDOMAINS).toContain("crm");
    expect(validateSubdomain("crm").ok).toBe(false);
    expect(parsePreviewHost("crm.ianverlinden.com", { baseDomain: "ianverlinden.com" })).toBeNull();
    expect(parsePreviewHost("geertkips.ianverlinden.com", { baseDomain: "ianverlinden.com" })).toBe("geertkips");
  });
});

describe("proxy: the CRM host", () => {
  const env = () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  };
  const HOST = "crm.ianverlinden.com";

  it("sends visitors without a session to the CRM's own login", async () => {
    env();
    for (const path of ["/", "/prospects", "/pipeline", "/quotes", "/quotes/abc/pdf", "/follow-ups", "/clients", "/settings"]) {
      const res = await call(`https://${HOST}${path}`, HOST);
      expect(res.status, path).toBe(307);
      expect(res.headers.get("location"), path).toBe(`https://${HOST}/login`);
    }
  });

  it("lets the login page render and routes it into the internal tree, marked as CRM", async () => {
    env();
    const res = await call(`https://${HOST}/login`, HOST);
    expect(res.status).toBe(200);
    expect(rewriteTarget(res)).toBe(`https://${HOST}/crm/login`);
    expect(res.headers.get(`x-middleware-request-${CRM_APP_HEADER}`)).toBe("1");
  });

  it("never serves the internal prefix, the website admin or the gateway on the CRM host", async () => {
    env();
    for (const path of ["/crm", "/crm/prospects", "/crm/login", "/admin", "/admin/quotes", "/admin/login", "/gw-preview/x"]) {
      const res = await call(`https://${HOST}${path}`, HOST);
      expect(res.status, path).toBe(404);
    }
  });

  it("does not turn the CRM host into a preview or a public-site host", async () => {
    env();
    const res = await call(`https://${HOST}/`, HOST);
    expect(rewriteTarget(res)?.includes("/gw-preview")).toBeFalsy();
    expect(rewriteTarget(res)?.includes("/nl")).toBeFalsy();
  });
});

describe("proxy: the CRM tree does not exist on any other host", () => {
  it("answers 404 for /crm and below on the apex, www, previews-lookalikes and other hosts", async () => {
    for (const host of ["ianverlinden.com", "www.ianverlinden.com", "my-app-abc.vercel.app"]) {
      for (const path of ["/crm", "/crm/prospects", "/crm/quotes/1/pdf", "/crm/login"]) {
        const res = await call(`https://${host}${path}`, host);
        expect(res.status, `${host}${path}`).toBe(404);
      }
    }
  });

  it("keeps /admin and the public site exactly as they were", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    const admin = await call("https://ianverlinden.com/admin/quotes", "ianverlinden.com");
    expect(admin.status).toBe(307);
    expect(admin.headers.get("location")).toBe("https://ianverlinden.com/admin/login");
    expect(rewriteTarget(await call("https://ianverlinden.com/", "ianverlinden.com"))).toBe("https://ianverlinden.com/nl");
    expect(rewriteTarget(await call("https://geertkips.ianverlinden.com/", "geertkips.ianverlinden.com"))).toContain("/gw-preview");
  });
});

describe("proxy: the dedicated preview gateway deployment", () => {
  it("never serves the CRM: every non-preview host, the CRM host included, is a 404", async () => {
    vi.stubEnv("PREVIEW_GATEWAY_ONLY", "1");
    for (const path of ["/", "/login", "/prospects", "/quotes", "/pipeline", "/crm", "/crm/prospects"]) {
      expect((await call(`https://crm.ianverlinden.com${path}`, "crm.ianverlinden.com")).status, path).toBe(404);
    }
    expect(rewriteTarget(await call("https://geertkips.ianverlinden.com/", "geertkips.ianverlinden.com"))).toContain("/gw-preview");
  });
});

describe("CRM auth rules (visible paths)", () => {
  it("recognises the login path and nothing that merely starts like it", () => {
    expect(isCrmLoginPath("/login")).toBe(true);
    expect(isCrmLoginPath("/login/x")).toBe(true);
    expect(isCrmLoginPath("/loginx")).toBe(false);
    expect(isCrmLoginPath("/prospects/login")).toBe(false);
  });

  it("requires a session everywhere except the login page", () => {
    for (const path of ["/", "/prospects", "/quotes/1/pdf", "/settings", "/anything"]) {
      expect(decideCrmRoute(path, false), path).toBe("to-login");
      expect(decideCrmRoute(path, true), path).toBe("allow");
    }
    expect(decideCrmRoute("/login", false)).toBe("allow");
    expect(decideCrmRoute("/login", true)).toBe("check-admin-then-home");
  });
});

describe("path tables", () => {
  it("the legacy admin table keeps every existing URL", () => {
    expect(adminPaths.prospects).toBe("/admin/prospects");
    expect(adminPaths.pipeline).toBe("/admin/prospects/kanban");
    expect(adminPaths.prospect("1")).toBe("/admin/prospects/1");
    expect(adminPaths.prospectEdit("1")).toBe("/admin/prospects/1/edit");
    expect(adminPaths.quotes).toBe("/admin/quotes");
    expect(adminPaths.quoteNew("p1")).toBe("/admin/quotes/new?prospect=p1");
    expect(adminPaths.quotePdf("q1")).toBe("/admin/quotes/q1/pdf");
    expect(adminPaths.settings).toBe("/admin/settings/quotes");
    expect(adminPaths.prospectImportApi).toBe("/admin/prospects/import/api");
    expect(adminPaths.followUps).toBeNull();
  });

  it("the CRM table has no /admin and no /crm prefix", () => {
    const flat = JSON.stringify(
      Object.entries(crmPaths)
        .filter(([k]) => k !== "website" && k !== "crmHome")
        .map(([, v]) => (typeof v === "function" ? (v as (...a: string[]) => string)("id") : v)),
    );
    expect(flat).not.toContain("/admin");
    expect(flat).not.toContain("/crm");
    expect(crmPaths.home).toBe("/");
    expect(crmPaths.pipeline).toBe("/pipeline");
    expect(crmPaths.quote("q1")).toBe("/quotes/q1");
    expect(crmPaths.prospectTab("p1", "email")).toBe("/prospects/p1?tab=email");
    expect(crmPaths.prospectTab("p1", "overview")).toBe("/prospects/p1");
    expect(crmPaths.followUps).toBe("/follow-ups");
    expect(crmPaths.clients).toBe("/clients");
  });

  it("website screens are absolute on the CRM and relative on the admin", () => {
    expect(crmPaths.website.projectEdit("x")).toBe("https://ianverlinden.com/admin/projects/x/edit");
    expect(crmPaths.website.integrations).toBe("https://ianverlinden.com/admin/settings/integrations");
    expect(adminPaths.website.projectEdit("x")).toBe("/admin/projects/x/edit");
    expect(crmPaths.crmHome).toBe("https://crm.ianverlinden.com");
    expect(pathsFor("crm")).toBe(crmPaths);
    expect(pathsFor("admin")).toBe(adminPaths);
  });
});

describe("CRM navigation", () => {
  const items = CRM_NAV.flatMap((g) => g.items);

  it("follows the agreed structure and links only to screens that exist", () => {
    expect(items.map((i) => i.href)).toEqual(["/", "/prospects", "/pipeline", "/follow-ups", "/clients", "/quotes", "/projects", "/settings"]);
    expect(CRM_NAV.map((g) => g.label)).toEqual([null, "Sales", "Work", null]);
  });

  it("does not show planned (future billing) areas", () => {
    expect(items.some((i) => i.planned)).toBe(false);
  });

  it("highlights the section you are in, and the dashboard only on the dashboard", () => {
    expect(isActiveCrmPath("/", "/")).toBe(true);
    expect(isActiveCrmPath("/", "/prospects")).toBe(false);
    expect(isActiveCrmPath("/prospects", "/prospects/abc")).toBe(true);
    expect(isActiveCrmPath("/prospects", "/prospectsx")).toBe(false);
    expect(isActiveCrmPath("/quotes", "/quotes/abc/edit")).toBe(true);
  });
});

import { legacyCrmPath, legacyCrmRedirect, legacyRedirectsEnabled } from "@/lib/crm/legacy-redirects";
import { adminModules } from "@/components/admin/admin-modules";

describe("legacy CRM routes in the website admin", () => {
  const id = "43dfaeac-817d-43e1-a5a1-f240db8fa0a7";

  it("maps every retired CRM screen to its CRM equivalent", () => {
    expect(legacyCrmPath("/admin/prospects")).toBe("/prospects");
    expect(legacyCrmPath("/admin/prospects/kanban")).toBe("/pipeline");
    expect(legacyCrmPath("/admin/prospects/new")).toBe("/prospects/new");
    expect(legacyCrmPath("/admin/prospects/import")).toBe("/prospects/import");
    expect(legacyCrmPath(`/admin/prospects/${id}`)).toBe(`/prospects/${id}`);
    expect(legacyCrmPath(`/admin/prospects/${id}/edit`)).toBe(`/prospects/${id}/edit`);
    expect(legacyCrmPath("/admin/quotes")).toBe("/quotes");
    expect(legacyCrmPath("/admin/quotes/new")).toBe("/quotes/new");
    expect(legacyCrmPath("/admin/quotes/templates")).toBe("/quotes/templates");
    expect(legacyCrmPath(`/admin/quotes/${id}`)).toBe(`/quotes/${id}`);
    expect(legacyCrmPath(`/admin/quotes/${id}/pdf`)).toBe(`/quotes/${id}/pdf`);
    expect(legacyCrmPath("/admin/settings/quotes")).toBe("/settings");
    expect(legacyCrmPath("/admin/quotes/")).toBe("/quotes");
  });

  it("leaves website administration (and the handlers/connection pages that stay) alone", () => {
    for (const path of ["/admin", "/admin/projects", "/admin/previews", "/admin/reviews", "/admin/inquiries", "/admin/media", "/admin/pages", "/admin/settings", "/admin/settings/integrations", "/admin/settings/integrations/zoho/connect", "/admin/prospects/export", "/admin/prospects/import/api", "/admin/prospects/not-an-id", "/admin/quotes/not-an-id"]) {
      expect(legacyCrmPath(path), path).toBeNull();
    }
  });

  it("redirects to the CRM host with the query string, and the target is not itself a legacy path (no loops)", () => {
    const target = legacyCrmRedirect("/admin/prospects", "?status=interested&q=garage", {});
    expect(target).toBe("https://crm.ianverlinden.com/prospects?status=interested&q=garage");
    expect(legacyCrmPath(new URL(target!).pathname)).toBeNull();
    expect(legacyCrmRedirect("/admin/projects", "", {})).toBeNull();
  });

  it("is switched off unless CRM_LEGACY_REDIRECTS=1", () => {
    expect(legacyRedirectsEnabled({})).toBe(false);
    expect(legacyRedirectsEnabled({ CRM_LEGACY_REDIRECTS: "0" })).toBe(false);
    expect(legacyRedirectsEnabled({ CRM_LEGACY_REDIRECTS: "1" })).toBe(true);
  });

  it("the proxy redirects retired screens only when switched on, and only for GET", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    const off = await call("https://ianverlinden.com/admin/quotes", "ianverlinden.com");
    expect(off.headers.get("location")).toBe("https://ianverlinden.com/admin/login");
    vi.stubEnv("CRM_LEGACY_REDIRECTS", "1");
    const on = await call("https://ianverlinden.com/admin/quotes?status=sent", "ianverlinden.com");
    expect(on.status).toBe(307);
    expect(on.headers.get("location")).toBe("https://crm.ianverlinden.com/quotes?status=sent");
    const stays = await call("https://ianverlinden.com/admin/projects", "ianverlinden.com");
    expect(stays.headers.get("location")).toBe("https://ianverlinden.com/admin/login");
    const post = await proxy(new NextRequest("https://ianverlinden.com/admin/quotes", { method: "POST", headers: { host: "ianverlinden.com" } }));
    expect(post.headers.get("location")?.includes("crm.ianverlinden.com")).toBeFalsy();
  });
});

describe("website admin navigation", () => {
  it("no longer lists the CRM screens, and offers Open CRM", () => {
    const ids = adminModules.map((m) => m.id);
    expect(ids).not.toContain("prospects");
    expect(ids).not.toContain("quotes");
    expect(ids).toEqual(["dashboard", "projects", "previews", "reviews", "inquiries", "media", "pages", "settings", "crm"]);
    const crm = adminModules.find((m) => m.id === "crm")!;
    expect(crm.external).toBe(true);
    expect(crm.href).toBe("https://crm.ianverlinden.com");
    expect(adminModules.find((m) => m.id === "projects")!.label).toBe("Portfolio");
  });
});
