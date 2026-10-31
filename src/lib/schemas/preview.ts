import { z } from "zod";
import { validateAccessCode } from "@/lib/preview/access-code";
import { validateSubdomain } from "@/lib/preview/subdomain";
import { validateTargetUrl } from "@/lib/preview/target-url";

export const SESSION_HOUR_OPTIONS = [24, 168, 336] as const;
export const DEFAULT_SESSION_HOURS = 168;

/** The apex is always blocked as a target here; the server also blocks the configured PREVIEW_BASE_DOMAIN. */
export const STATIC_BLOCKED_DOMAINS = ["ianverlinden.com"];

const text = (label: string, max: number) =>
  z.string().trim().min(1, `Enter the ${label}.`).max(max, `Keep the ${label} under ${max} characters.`);

export const expirySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("keep") }),
  z.object({ kind: z.literal("never") }),
  z.object({ kind: z.literal("days"), days: z.union([z.literal(7), z.literal(14), z.literal(30)]) }),
  z.object({ kind: z.literal("date"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date.") }),
]);

/** Fields shared by "create" and "edit". Everything is validated again on the server. */
export const previewDetailsSchema = z.object({
  clientName: text("client name", 120),
  projectName: text("project name", 120),
  subdomain: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .superRefine((value, ctx) => {
      const check = validateSubdomain(value);
      if (!check.ok) ctx.addIssue({ code: "custom", message: check.error });
    }),
  targetUrl: z.string().superRefine((value, ctx) => {
    const check = validateTargetUrl(value, { blockedDomains: STATIC_BLOCKED_DOMAINS });
    if (!check.ok) ctx.addIssue({ code: "custom", message: check.error });
  }),
  expiry: expirySchema,
  sessionTtlHours: z.union([z.literal(24), z.literal(168), z.literal(336)]),
  notes: z.string().trim().max(2000, "Keep the notes under 2000 characters."),
});
export type PreviewDetailsValues = z.input<typeof previewDetailsSchema>;

export const accessCodeSchema = z.string().superRefine((value, ctx) => {
  const check = validateAccessCode(value);
  if (!check.ok) ctx.addIssue({ code: "custom", message: check.error });
});

export const previewCreateSchema = previewDetailsSchema.extend({ code: accessCodeSchema });
