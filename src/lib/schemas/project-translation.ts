import { z } from "zod";

const text = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters.`);

/**
 * A project's Dutch translation (stored in `projects.translations.nl`). Every
 * field is optional: an empty field falls back to the English base text.
 * Brand and product names are never translated, so there is no slug field
 * (slugs are shared between languages).
 */
export const projectTranslationSchema = z.object({
  title: text(120),
  subtitle: text(160),
  shortDescription: text(400),
  description: text(8000),
  category: text(80),
  features: z.array(text(120)).max(20, "Use at most 20 features."),
  /** Dutch image captions, by project_media id. */
  captions: z.record(z.string(), text(300)).optional(),
});
export type ProjectTranslation = z.infer<typeof projectTranslationSchema>;

export const emptyProjectTranslation: ProjectTranslation = {
  title: "",
  subtitle: "",
  shortDescription: "",
  description: "",
  category: "",
  features: [],
};

/** Which fields still lack a translation (used for the admin status hint). */
export function missingTranslationFields(t: Partial<ProjectTranslation> | undefined): string[] {
  const missing: string[] = [];
  if (!t?.shortDescription?.trim()) missing.push("short description");
  if (!t?.description?.trim()) missing.push("description");
  if (!t?.subtitle?.trim()) missing.push("subtitle");
  if (!t?.category?.trim()) missing.push("category");
  return missing;
}
