import type { SiteSettings } from "@/lib/schemas/site-content";

type Thing = Record<string, unknown>;

/**
 * schema.org JSON-LD built only from the site settings. Nothing is invented:
 * empty fields are omitted, and there is deliberately no rating, review or
 * aggregateRating markup (self-serving review markup is not eligible for rich results).
 */
export function buildSiteStructuredData(settings: SiteSettings, origin: string): Thing {
  const sameAs = [settings.githubUrl, settings.linkedinUrl, settings.instagramUrl, settings.xUrl].filter(
    (url): url is string => Boolean(url),
  );
  const personId = `${origin}/#person`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        url: origin,
        name: settings.siteName,
        description: settings.seoDefaultDescription,
        inLanguage: "en",
        publisher: { "@id": personId },
      },
      {
        "@type": "Person",
        "@id": personId,
        name: settings.displayName,
        url: origin,
        jobTitle: "Web designer and developer",
        ...(sameAs.length > 0 && { sameAs }),
        ...(settings.contactEmail && { email: settings.contactEmail }),
      },
      {
        "@type": "ProfessionalService",
        "@id": `${origin}/#service`,
        name: settings.siteName,
        url: origin,
        description: settings.seoDefaultDescription,
        founder: { "@id": personId },
        ...(sameAs.length > 0 && { sameAs }),
        ...(settings.contactEmail && { email: settings.contactEmail }),
      },
    ],
  };
}

/** JSON for a <script type="application/ld+json"> tag; `<` is escaped so content can't close the tag. */
export function serializeJsonLd(data: Thing): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
