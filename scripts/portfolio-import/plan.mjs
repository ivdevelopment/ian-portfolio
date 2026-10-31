/**
 * Turns the portfolio manifest + curation into the exact rows and files the CMS
 * should hold. No database access here, so tests can check a plan against the
 * admin's own schemas.
 *
 * Identity: every id is a UUIDv5 derived from the project slug, so a re-run
 * addresses the same rows, and an imported record can always be told apart from
 * one created in the admin. Storage files are named from their content hash:
 * an unchanged file is never re-uploaded, a changed one gets a new URL (uploads
 * are cached for a year).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { CONCEPTS } from "./curation.mjs";

export const DEFAULT_MANIFEST = "D:/Websites/Portfolio Assets/portfolio-projects.json";

const NAMESPACE = "8a6d1c3e-52f4-4b7a-9e10-3c7b2d9f4a61";

export function uuidV5(name) {
  const hash = createHash("sha1")
    .update(Buffer.from(NAMESPACE.replaceAll("-", ""), "hex"))
    .update(name)
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const projectIdFor = (slug) => uuidV5(`project:${slug}`);

/** Implementation technologies only: fonts and build details stay out of the public list. */
function publicTechnologies(stack) {
  const known = [
    [/^Next\.js/, "Next.js"],
    [/^React/, "React"],
    [/^TypeScript/, "TypeScript"],
    [/^Tailwind CSS/, "Tailwind CSS"],
    [/^CSS custom properties/, "CSS"],
    [/^Cloudflare Workers/, "Cloudflare Workers"],
  ];
  return known.flatMap(([pattern, label]) => (stack.some((s) => pattern.test(s)) ? [label] : []));
}

/** Refuses broken encoding, then applies the official spelling of the name. */
function cleanText(value, where) {
  if (/Ã|Â|â€/.test(value)) throw new Error(`Broken encoding in ${where}: ${value}`);
  return value.replaceAll("ATELIER NOIR", "Atelier Noir");
}

/** 16:10 stage crops portrait media, so phone shots are shown centred on a dark 16:10 canvas. */
export function framedMobilePath(mobile) {
  return join(dirname(mobile.path), basename(mobile.path).replace(/\.webp$/, "-framed.webp"));
}

export async function ensureFramedMobile(mobile) {
  const target = framedMobilePath(mobile);
  if (existsSync(target)) return target;
  const { default: sharp } = await import("sharp");
  const height = 920;
  const width = Math.round((mobile.width / mobile.height) * height);
  const radius = 44;
  const phone = await sharp(mobile.path)
    .resize(width, height)
    .composite([
      {
        input: Buffer.from(
          `<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" ry="${radius}"/></svg>`,
        ),
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
  await sharp({ create: { width: 1600, height: 1000, channels: 3, background: "#121316" } })
    .composite([{ input: phone, gravity: "center" }])
    .webp({ quality: 84 })
    .toFile(target);
  return target;
}

export function readManifest(manifestPath = DEFAULT_MANIFEST) {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

/** Builds the full import plan. Rejects anything the manifest and curation disagree on. */
export async function buildPlan(manifest) {
  return Promise.all(
    CONCEPTS.map(async (concept) => {
      const source = manifest.projects.find((p) => p.slug === concept.slug);
      if (!source) throw new Error(`Manifest has no project "${concept.slug}".`);
      const { cms } = source;
      const id = projectIdFor(concept.slug);
      const nl = cms.translations.nl;
      const title = concept.title ?? cms.title;

      const shots = new Map(source.screenshots.map((s) => [s.key, s]));
      const shot = (key) => {
        const found = shots.get(key);
        if (!found) throw new Error(`${concept.slug}: no screenshot "${key}" in the manifest.`);
        return found;
      };
      const mobile = source.mobileScreenshot;
      const images = [
        { ...source.coverImage, key: "cover" },
        ...concept.gallery.map(shot),
        { ...mobile, path: await ensureFramedMobile(mobile) },
      ];

      const media = images.map((image) => {
        const sha256 = createHash("sha256").update(readFileSync(image.path)).digest("hex");
        const nlCaption = concept.captionsNl[image.key];
        if (!nlCaption) throw new Error(`${concept.slug}: no Dutch caption for "${image.key}".`);
        return {
          id: uuidV5(`media:${concept.slug}:${image.key}`),
          key: image.key,
          localPath: image.path,
          storagePath: `projects/${id}/${uuidV5(`file:${concept.slug}:${sha256}`)}.webp`,
          alt: cleanText(concept.captionsEn?.[image.key] ?? image.label, `${concept.slug}/${image.key}`),
          altNl: cleanText(nlCaption, `${concept.slug}/${image.key}`),
        };
      });

      const row = {
        id,
        slug: concept.slug,
        title,
        subtitle: cleanText(cms.subtitle, concept.slug),
        short_description: cleanText(cms.shortDescription, concept.slug),
        description: cleanText(cms.description, concept.slug),
        category: concept.sector.en,
        kind: "concept",
        year: Number(cms.year),
        client: null,
        project_type: "concept",
        thumbnail_path: media[0].storagePath,
        tags: ["Web Design", "Development", concept.sector.en],
        technologies: publicTechnologies(source.technologyStack),
        live_url: source.liveDemoUrl,
        preview_url: null,
        github_url: null,
        preview_mode: "external",
        featured: concept.featured,
        published: true,
        is_example: false,
        sort_order: concept.sortOrder,
      };

      const translationNl = {
        title: "",
        subtitle: cleanText(nl.subtitle, concept.slug),
        shortDescription: cleanText(nl.shortDescription, concept.slug),
        description: cleanText(nl.description, concept.slug),
        category: concept.sector.nl,
        features: nl.features.map((f) => cleanText(f, concept.slug)),
        captions: Object.fromEntries(media.map((m) => [m.id, m.altNl])),
      };

      return {
        row,
        translationNl,
        features: cms.features.map((f) => cleanText(f.label, concept.slug)),
        media,
      };
    }),
  );
}
