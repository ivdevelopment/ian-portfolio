export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 80;

/** "Red Harbor — Studios!" -> "red-harbor-studios". Strips accents; never returns leading/trailing hyphens. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(slug);
}

/** Next free slug: "name", "name-2", "name-3"… given the slugs already taken. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = slugify(base) || "project";
  if (!used.has(root)) return root;
  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`;
    const candidate = `${root.slice(0, SLUG_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${root.slice(0, SLUG_MAX_LENGTH - 9)}-${Date.now().toString(36)}`;
}
