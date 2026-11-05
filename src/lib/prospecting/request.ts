import { z } from "zod";
import { MODE_INFO, SEARCH_MODES, type DiscoveryRequest } from "./types";

/** Optional text as the form sends it: missing, null or blank all mean "not given". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const requestSchema = z.object({
  mode: z.enum(SEARCH_MODES),
  location: z.string().trim().min(1, "Enter a location.").max(160),
  area: optionalText(160),
  industry: optionalText(160),
  count: z.number().int().min(1).max(50),
  threshold: z.number().int().min(0).max(100),
  excludeResearched: z.boolean(),
});

/** Validates the search form's values on the server. The result count is capped at what the mode allows; an Industry Hunt needs an industry. */
export function parseDiscoveryRequest(input: unknown): { ok: true; request: DiscoveryRequest } | { ok: false; error: string } {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the search settings." };
  const value = parsed.data;
  if (value.mode === "industry" && !value.industry) return { ok: false, error: "Enter the industry to hunt in." };
  return { ok: true, request: { ...value, count: Math.min(value.count, MODE_INFO[value.mode].maxCount) } };
}
