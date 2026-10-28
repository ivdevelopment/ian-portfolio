import { z } from "zod";
import { BUDGETS, PROJECT_TYPES } from "@/data/inquiry-options";

/** Shared by the client form (react-hook-form) and the server action. */
export const inquirySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Please enter your name.")
    .max(120, "That name is a little long."),
  email: z
    .string()
    .trim()
    .min(1, "Please enter your email.")
    .max(200)
    .pipe(z.email("Please enter a valid email address.")),
  projectType: z.enum(PROJECT_TYPES, { error: "Choose what you need." }),
  budget: z.enum(BUDGETS, { error: "Choose a budget range." }),
  message: z
    .string()
    .trim()
    .min(20, "Tell me a bit more — at least a couple of sentences.")
    .max(4000, "Please keep this under 4000 characters."),
  /** Honeypot: real visitors never see or fill this. */
  company: z.string().max(0).optional(),
});

export type InquiryValues = z.infer<typeof inquirySchema>;

export type InquiryResult =
  | { status: "invalid"; fieldErrors: Record<string, string[] | undefined> }
  /** Validation passed but no backend is attached yet (P0). Nothing was sent. */
  | { status: "not_configured" }
  | { status: "sent" }
  | { status: "error"; message: string };
