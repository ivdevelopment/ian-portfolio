import { describe, expect, it } from "vitest";
import { defaultLocale, htmlLang, isLocale, locales } from "@/i18n/config";
import { fmt, getDictionary } from "@/i18n/dictionaries";
import { en } from "@/i18n/dictionaries/en";
import { nl } from "@/i18n/dictionaries/nl";
import { formatBudgetLabel, formatDate, formatDateTime } from "@/i18n/format";
import { knownDutch } from "@/i18n/known-dutch";
import { localizeContent, localizeLocation, localizeText } from "@/i18n/localize-content";
import { absoluteAlternates, localizeHref, stripLocale, switchLocalePath } from "@/i18n/paths";
import { decideLocaleRoute } from "@/i18n/routing";
import { localeAlternates, pageMetadata } from "@/lib/page-metadata";
import { rowToProject, type ProjectRow } from "@/lib/cms/mappers";

describe("locale config", () => {
  it("makes Dutch the default and English the secondary language", () => {
    expect(defaultLocale).toBe("nl");
    expect([...locales]).toEqual(["nl", "en"]);
    expect(isLocale("nl")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(htmlLang).toEqual({ nl: "nl-BE", en: "en" });
  });
});

describe("locale-aware URLs", () => {
  it("leaves Dutch paths bare and prefixes English with /en", () => {
    expect(localizeHref("nl", "/work")).toBe("/work");
    expect(localizeHref("nl", "/")).toBe("/");
    expect(localizeHref("en", "/")).toBe("/en");
    expect(localizeHref("en", "/work/red-harbor-studios")).toBe("/en/work/red-harbor-studios");
    expect(localizeHref("en", "/services#web-design")).toBe("/en/services#web-design");
    expect(localizeHref("en", "/contact?x=1")).toBe("/en/contact?x=1");
  });

  it("never double-prefixes or localizes admin, api, external or hash links", () => {
    expect(localizeHref("en", "/en/work")).toBe("/en/work");
    expect(localizeHref("nl", "/en/work")).toBe("/work");
    for (const href of ["/admin/inquiries", "/api/contact", "https://example.com/x", "#live-preview", "mailto:a@b.c", "//evil.com"]) {
      expect(localizeHref("en", href)).toBe(href);
    }
  });

  it("strips the locale from a pathname", () => {
    expect(stripLocale("/en/about")).toEqual({ locale: "en", path: "/about", prefixed: true });
    expect(stripLocale("/en")).toEqual({ locale: "en", path: "/", prefixed: true });
    expect(stripLocale("/about")).toEqual({ locale: "nl", path: "/about", prefixed: false });
    expect(stripLocale("/")).toEqual({ locale: "nl", path: "/", prefixed: false });
    expect(stripLocale("/entertainment").prefixed).toBe(false);
  });

  it("switches language while keeping the logical page", () => {
    expect(switchLocalePath("/about", "en")).toBe("/en/about");
    expect(switchLocalePath("/en/work/red-harbor-studios", "nl")).toBe("/work/red-harbor-studios");
    expect(switchLocalePath("/", "en")).toBe("/en");
    expect(switchLocalePath("/en", "nl")).toBe("/");
    expect(switchLocalePath("/en/contact", "en")).toBe("/en/contact");
  });

  it("builds absolute alternates for both languages", () => {
    expect(absoluteAlternates("https://ianverlinden.com/", "/about")).toEqual({
      nl: "https://ianverlinden.com/about",
      en: "https://ianverlinden.com/en/about",
    });
    expect(absoluteAlternates("https://ianverlinden.com", "/")).toEqual({
      nl: "https://ianverlinden.com",
      en: "https://ianverlinden.com/en",
    });
  });
});

describe("locale routing decisions", () => {
  it("serves Dutch without a prefix by rewriting to /nl internally", () => {
    expect(decideLocaleRoute("/", "", undefined)).toEqual({ type: "rewrite", path: "/nl" });
    expect(decideLocaleRoute("/work", "", undefined)).toEqual({ type: "rewrite", path: "/nl/work" });
    expect(decideLocaleRoute("/work/x", "", undefined)).toEqual({ type: "rewrite", path: "/nl/work/x" });
    expect(decideLocaleRoute("/review/abc", "", undefined)).toEqual({ type: "rewrite", path: "/nl/review/abc" });
  });

  it("passes /en through untouched", () => {
    for (const p of ["/en", "/en/work", "/en/review/abc"]) {
      expect(decideLocaleRoute(p, "", undefined)).toEqual({ type: "next" });
    }
  });

  it("permanently redirects an explicit /nl to the bare Dutch URL, keeping the query", () => {
    expect(decideLocaleRoute("/nl", "", undefined)).toEqual({ type: "redirect", path: "/", status: 308 });
    expect(decideLocaleRoute("/nl/about", "?a=1", undefined)).toEqual({ type: "redirect", path: "/about?a=1", status: 308 });
  });

  it("honours a remembered English choice only on the bare homepage, never on explicit URLs", () => {
    expect(decideLocaleRoute("/", "", "en")).toMatchObject({ type: "redirect", path: "/en", status: 307, noStore: true });
    expect(decideLocaleRoute("/about", "", "en")).toEqual({ type: "rewrite", path: "/nl/about" });
    expect(decideLocaleRoute("/en", "", "nl")).toEqual({ type: "next" });
    expect(decideLocaleRoute("/", "", "nl")).toEqual({ type: "rewrite", path: "/nl" });
    expect(decideLocaleRoute("/", "", "garbage")).toEqual({ type: "rewrite", path: "/nl" });
  });

  it("cannot loop: the redirect target is a pass-through", () => {
    const first = decideLocaleRoute("/", "", "en");
    expect(first.type === "redirect" && decideLocaleRoute(first.path, "", "en")).toEqual({ type: "next" });
  });
});

describe("dictionaries", () => {
  const keys = (o: unknown, prefix = ""): string[] =>
    typeof o === "object" && o !== null
      ? Object.entries(o).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
      : [prefix.slice(0, -1)];

  it("have identical keys in Dutch and English, and no empty Dutch strings", () => {
    expect(keys(nl).sort()).toEqual(keys(en).sort());
    const empties = keys(nl).filter((k) => {
      const v = k.split(".").reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], nl);
      return typeof v === "string" && v === "" && k !== "home.availabilityFallback";
    });
    expect(empties).toEqual([]);
  });

  it("use the requested Dutch navigation and key labels", () => {
    expect(getDictionary("nl").nav).toMatchObject({
      home: "Home",
      work: "Werk",
      services: "Diensten",
      about: "Over mij",
      contact: "Contact",
      cta: "Start een project",
    });
    expect(getDictionary("nl").contact.form).toMatchObject({
      name: "Naam",
      email: "E-mail",
      projectType: "Wat heb je nodig?",
      budget: "Geschat budget",
      message: "Vertel me over je project",
      send: "Projectaanvraag versturen",
    });
    expect(getDictionary("nl").errors.notFoundTitle).toBe("Pagina niet gevonden");
    expect(getDictionary("nl").review.pageTitle).toBe("Deel je ervaring");
    expect(getDictionary("en").nav.work).toBe("Work");
  });

  it("keeps the stored enum values stable and only localizes labels", () => {
    expect(Object.keys(nl.contact.projectTypes)).toEqual(Object.keys(en.contact.projectTypes));
    expect(nl.contact.projectTypes["New website"]).toBe("Nieuwe website");
    expect(nl.contact.projectTypes["Web application"]).toBe("Webapplicatie");
  });

  it("fills placeholders", () => {
    expect(fmt("Hi {name}, {n}", { name: "Ian", n: 2 })).toBe("Hi Ian, 2");
    expect(fmt("Missing {x}", {})).toBe("Missing {x}");
  });
});

describe("date and currency formatting", () => {
  it("formats dates per language in the Brussels timezone", () => {
    expect(formatDate("nl", "2026-10-29T12:00:00Z")).toBe("29 oktober 2026");
    expect(formatDate("en", "2026-10-29T12:00:00Z")).toBe("October 29, 2026");
    // 23:30 UTC on the 28th is already the 29th in Brussels (CET/CEST).
    expect(formatDate("nl", "2026-10-28T23:30:00Z")).toBe("29 oktober 2026");
    expect(formatDateTime("en", "2026-10-29T12:00:00Z")).toContain("October 29, 2026");
  });

  it("formats budgets: Dutch '€ 1.000', English unchanged, stored values untouched", () => {
    expect(formatBudgetLabel("nl", "€1,000 – €2,500")).toBe("€ 1.000 – € 2.500");
    expect(formatBudgetLabel("nl", "< €1,000")).toBe("< € 1.000");
    expect(formatBudgetLabel("nl", "€5,000+")).toBe("€ 5.000+");
    expect(formatBudgetLabel("en", "€1,000 – €2,500")).toBe("€1,000 – €2,500");
  });
});

describe("content localization and fallback", () => {
  const home = {
    hero: {
      badge: "Available for new projects",
      headline: { line1: "Modern websites", line2: "for", accent: "ambitious brands." },
      body: "I design and develop high-quality websites and web applications that look great, perform well and help businesses grow.",
      primaryCta: { label: "View my work", href: "/work" },
      image: { src: "site/hero/x.png", alt: "" },
    },
    stats: [{ value: "12+", label: "Projects completed", enabled: true }],
  };

  it("returns the stored English content unchanged for English", () => {
    expect(localizeContent("en", home, { hero: { badge: "ignored" } })).toBe(home);
  });

  it("renders known English copy in Dutch and keeps structure from the base row", () => {
    const out = localizeContent("nl", home);
    expect(out.hero.headline).toEqual({ line1: "Moderne websites", line2: "voor", accent: "ambitieuze merken." });
    expect(out.hero.body).toBe(
      "Ik ontwerp en ontwikkel hoogwaardige websites en webapplicaties die er sterk uitzien, snel werken en bedrijven helpen groeien.",
    );
    expect(out.hero.primaryCta).toEqual({ label: "Bekijk mijn werk", href: "/work" });
    expect(out.hero.image.src).toBe("site/hero/x.png");
    expect(out.stats[0]).toEqual({ value: "12+", label: "Afgeronde projecten", enabled: true });
  });

  it("prefers an admin-saved translation, ignoring structural fields in it", () => {
    const out = localizeContent("nl", home, {
      hero: { badge: "Nu beschikbaar", primaryCta: { label: "Mijn werk", href: "/evil" }, image: { src: "/evil.png" } },
    });
    expect(out.hero.badge).toBe("Nu beschikbaar");
    expect(out.hero.primaryCta).toEqual({ label: "Mijn werk", href: "/work" });
    expect(out.hero.image.src).toBe("site/hero/x.png");
  });

  it("falls back to the existing text when there is no translation (never blanks, never breaks)", () => {
    const edited = { ...home, hero: { ...home.hero, badge: "Booking for January" } };
    expect(localizeContent("nl", edited).hero.badge).toBe("Booking for January");
    expect(localizeContent("nl", edited, { hero: { badge: "   " } }).hero.badge).toBe("Booking for January");
    expect(localizeContent("nl", edited, "garbage").hero.badge).toBe("Booking for January");
    expect(localizeText("nl", "Unknown copy", undefined)).toBe("Unknown copy");
  });

  it("only translates exact known strings and localizes the country in a location", () => {
    expect(knownDutch("Years of experience")).toBe("Jaar ervaring");
    expect(knownDutch("Years of experience!")).toBeUndefined();
    expect(localizeLocation("nl", "Belgium, 8000 Brugge")).toBe("België, 8000 Brugge");
    expect(localizeLocation("en", "Belgium, 8000 Brugge")).toBe("Belgium, 8000 Brugge");
    expect(localizeLocation("nl", "Belgium", "Vlaanderen")).toBe("Vlaanderen");
  });
});

describe("project localization", () => {
  const row = {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "red-harbor-studios",
    title: "Red Harbor Studios",
    subtitle: "Creative Audio Software",
    short_description: "A modern website for my audio software brand.",
    description: "Full English description.",
    category: "Web Design & Development",
    kind: "website",
    year: 2026,
    client: "Red Harbor Studios",
    project_type: "personal",
    thumbnail_path: null,
    tags: ["Web Design", "Development", "CMS"],
    technologies: ["Next.js"],
    live_url: null,
    preview_url: null,
    github_url: null,
    preview_mode: "media",
    featured: false,
    published: true,
    is_example: false,
    sort_order: 0,
    translations: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    published_at: null,
    project_media: [],
    project_features: [{ id: "f1", project_id: "p", label: "Fully responsive", sort_order: 0 }],
  } as unknown as ProjectRow;

  it("keeps English as saved", () => {
    const p = rowToProject(row, "en");
    expect(p.shortDescription).toBe("A modern website for my audio software brand.");
    expect(p.tags).toEqual(["Web Design", "Development", "CMS"]);
  });

  it("falls back to the English text (page stays available) but translates known descriptors", () => {
    const p = rowToProject(row, "nl");
    expect(p.title).toBe("Red Harbor Studios");
    expect(p.shortDescription).toBe("A modern website for my audio software brand.");
    expect(p.description).toBe("Full English description.");
    expect(p.subtitle).toBe("Creatieve audiosoftware");
    expect(p.category).toBe("Webdesign & webontwikkeling");
    expect(p.tags).toEqual(["Webdesign", "Ontwikkeling", "CMS"]);
    expect(p.keyFeatures).toEqual(["Fully responsive"]);
  });

  it("applies a saved Dutch translation field by field, leaving the slug and brand alone", () => {
    const withNl = {
      ...row,
      translations: { nl: { shortDescription: "Een moderne website voor mijn audiosoftwaremerk.", features: ["Volledig responsief"], title: "" } },
    } as unknown as ProjectRow;
    const p = rowToProject(withNl, "nl");
    expect(p.slug).toBe("red-harbor-studios");
    expect(p.title).toBe("Red Harbor Studios");
    expect(p.shortDescription).toBe("Een moderne website voor mijn audiosoftwaremerk.");
    expect(p.description).toBe("Full English description.");
    expect(p.keyFeatures).toEqual(["Volledig responsief"]);
    // English is unaffected by the Dutch translation.
    expect(rowToProject(withNl, "en").shortDescription).toBe("A modern website for my audio software brand.");
  });
});

describe("metadata alternates", () => {
  it("canonicalizes each language to itself and lists nl-BE, en and x-default", () => {
    expect(localeAlternates("nl", "/about")).toEqual({
      canonical: "/about",
      languages: { "nl-BE": "/about", en: "/en/about", "x-default": "/about" },
    });
    expect(localeAlternates("en", "/about")).toEqual({
      canonical: "/en/about",
      languages: { "nl-BE": "/about", en: "/en/about", "x-default": "/about" },
    });
  });

  it("uses the home paths '/' and '/en'", () => {
    expect(localeAlternates("nl", "/").canonical).toBe("/");
    expect(localeAlternates("en", "/").canonical).toBe("/en");
  });

  it("emits localized Open Graph and per-language share images", () => {
    const m = pageMetadata({ locale: "en", title: "Work", description: "d", path: "/work" });
    expect(m.openGraph).toMatchObject({ url: "/en/work", locale: "en_GB" });
    expect(JSON.stringify(m.openGraph)).toContain("/og/en");
    const n = pageMetadata({ locale: "nl", title: "Werk", description: "d", path: "/work" });
    expect(n.openGraph).toMatchObject({ url: "/work", locale: "nl_BE" });
    expect(JSON.stringify(n.twitter)).toContain("/og/nl");
  });
});
