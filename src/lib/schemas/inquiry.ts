import { z } from "zod";
import { getDictionary, type Dictionary } from "@/i18n/dictionaries";
import { BUDGETS, PROJECT_TYPES } from "@/data/inquiry-options";

/**
 * Shared by the client form (react-hook-form) and the server action/route.
 * Error messages come from the visitor's language; the accepted VALUES are the
 * stable English enum strings stored in the database.
 */
export function createInquirySchema(m: Dictionary["contact"]["validation"]) {
  return z.object({
    name: z.string().trim().min(2, m.nameRequired).max(120, m.nameLong),
    email: z
      .string()
      .trim()
      .min(1, m.emailRequired)
      .max(200, m.emailLong)
      .pipe(z.email(m.emailInvalid)),
    projectType: z.enum(PROJECT_TYPES, { error: m.typeRequired }),
    budget: z.enum(BUDGETS, { error: m.budgetRequired }),
    message: z.string().trim().min(20, m.messageShort).max(4000, m.messageLong),
    /** Honeypot: real visitors never see or fill this. */
    company: z.string().max(0).optional(),
  });
}

export const inquirySchema = createInquirySchema(getDictionary("en").contact.validation);

export type InquiryValues = z.infer<typeof inquirySchema>;

export type InquiryResult =
  | { status: "invalid"; fieldErrors: Record<string, string[] | undefined> }
  | { status: "sent" }
  | { status: "error"; message: string };

/** Inquiry statuses managed in the admin. */
export const INQUIRY_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "won",
  "lost",
  "archived",
] as const;

export const inquiryStatusSchema = z.enum(INQUIRY_STATUSES);
export type InquiryStatus = z.infer<typeof inquiryStatusSchema>;
