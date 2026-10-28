import { z } from "zod";
import { isHttpUrl, slugSchema } from "./project";

/* ------------------------------------------------------------------ primitives */

const short = (max: number, message?: string) => z.string().trim().max(max, message ?? `Keep this under ${max} characters.`);
const required = (max: number) => z.string().trim().min(1, "This field is required.").max(max, `Keep this under ${max} characters.`);

/** Internal path ("/work"), or an https:// / http:// URL. Rejects javascript:, data:, protocol-relative. */
export function isSafeHref(value: string): boolean {
  if (value.startsWith("/")) return !value.startsWith("//") && !value.includes("\\");
  return isHttpUrl(value);
}

const hrefSchema = z
  .string()
  .trim()
  .min(1, "A link is required.")
  .max(300)
  .refine(isSafeHref, "Use a path like /work or a full https:// URL.");

const ctaSchema = z.object({ label: required(60), href: hrefSchema });

/** Image reference: a Storage path (site/…), an app-relative /media path, or an https URL. */
export function isSafeImageSrc(value: string): boolean {
  return (
    /^site\/[a-z0-9-]+\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(value) ||
    /^\/media\/[A-Za-z0-9/_.-]+$/.test(value) ||
    /^https:\/\//.test(value)
  );
}

const imageSchema = z.object({
  src: z.string().trim().max(500).refine(isSafeImageSrc, "Choose an image."),
  alt: short(300),
});

const headlineSchema = z.object({
  line1: required(80),
  line2: short(80),
  accent: required(80),
});

/** Stats are an ordered list: array position is the sort order. */
const statSchema = z.object({
  value: required(20),
  label: required(60),
  enabled: z.boolean(),
});

/* ----------------------------------------------------------------------- pages */

export const homeContentSchema = z.object({
  hero: z.object({
    badge: short(80),
    headline: headlineSchema,
    body: required(400),
    primaryCta: ctaSchema,
    secondaryCta: ctaSchema,
    image: imageSchema,
  }),
  stats: z.array(statSchema).max(6, "Use at most 6 stats."),
  featured: z.object({ eyebrow: short(60), heading: required(80), body: short(300) }),
  services: z.object({
    eyebrow: short(60),
    heading: required(80),
    statement: short(200),
    body: short(400),
  }),
  reviews: z.object({ eyebrow: short(60), heading: required(80), body: short(300) }),
  cta: z.object({
    badge: short(60),
    heading: required(100),
    body: short(400),
    primaryCta: ctaSchema,
    secondaryCta: ctaSchema,
    image: imageSchema,
  }),
});
export type HomeContent = z.infer<typeof homeContentSchema>;

export const aboutContentSchema = z.object({
  eyebrow: short(60),
  headline: headlineSchema,
  intro: required(600),
  body: short(3000),
  portrait: imageSchema.nullable(),
  location: short(80),
  availability: short(200),
  metrics: z.array(statSchema).max(6, "Use at most 6 stats."),
});
export type AboutContent = z.infer<typeof aboutContentSchema>;

export const contactContentSchema = z.object({
  eyebrow: short(60),
  heading: required(100),
  description: short(400),
  email: z.union([z.literal(""), z.email("Enter a valid email address.").max(200)]),
  responseTime: short(200),
  availability: short(200),
});
export type ContactContent = z.infer<typeof contactContentSchema>;

/* -------------------------------------------------------------------- settings */

const socialUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || (isHttpUrl(v) && v.startsWith("https://")), "Use a full https:// URL.");

export const siteSettingsSchema = z.object({
  siteName: required(80),
  displayName: required(80),
  location: short(120),
  contactEmail: z.union([z.literal(""), z.email("Enter a valid email address.").max(200)]),
  githubUrl: socialUrl,
  linkedinUrl: socialUrl,
  instagramUrl: socialUrl,
  xUrl: socialUrl,
  seoDefaultTitle: required(120),
  seoTitleTemplate: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .refine((v) => v.includes("%s"), "The template must contain %s where the page title goes."),
  seoDefaultDescription: required(320),
  seoOgTitle: short(120),
});
export type SiteSettings = z.infer<typeof siteSettingsSchema>;

/* ------------------------------------------------------- services and skills */

export const SERVICE_ICONS = [
  "design",
  "development",
  "redesign",
  "maintenance",
  "performance",
  "seo",
  "cms",
  "support",
  "strategy",
  "ecommerce",
] as const;
export type ServiceIconId = (typeof SERVICE_ICONS)[number];

export const serviceItemSchema = z.object({
  id: z.uuid(),
  slug: slugSchema,
  title: required(80),
  description: required(300),
  icon: z.enum(SERVICE_ICONS),
  includes: z.array(z.object({ label: required(120) })).max(8, "Use at most 8 items."),
  enabled: z.boolean(),
});

export const servicesListSchema = z
  .array(serviceItemSchema)
  .max(12, "Use at most 12 services.")
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((s, i) => {
      if (seen.has(s.slug)) {
        ctx.addIssue({ code: "custom", path: [i, "slug"], message: "Each service needs a unique slug." });
      }
      seen.add(s.slug);
    });
  });
export type ServiceItem = z.infer<typeof serviceItemSchema>;

export const skillItemSchema = z.object({
  id: z.uuid(),
  name: required(60),
  enabled: z.boolean(),
});
export const skillsListSchema = z.array(skillItemSchema).max(40, "Use at most 40 skills.");
export type SkillItem = z.infer<typeof skillItemSchema>;

/* ------------------------------------------------------------ editor wrappers */

export const homeEditorSchema = z.object({ content: homeContentSchema });
export const servicesEditorSchema = z.object({ services: servicesListSchema });
export const skillsEditorSchema = z.object({ skills: skillsListSchema });

/** Stats shown to visitors: enabled ones only, in the saved order. */
export function visibleStats<T extends { enabled: boolean }>(stats: T[]): T[] {
  return stats.filter((s) => s.enabled);
}
