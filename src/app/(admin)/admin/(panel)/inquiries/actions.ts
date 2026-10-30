"use server";

import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { inquiryStatusSchema } from "@/lib/schemas/inquiry";

export type InquiryActionResult = { ok: true } | { ok: false; error: string };

export async function updateInquiryStatusAction(
  id: string,
  status: string,
): Promise<InquiryActionResult> {
  const { supabase } = await requireAdmin();

  const parsedId = z.uuid().safeParse(id);
  const parsedStatus = inquiryStatusSchema.safeParse(status);
  if (!parsedId.success || !parsedStatus.success) {
    return { ok: false, error: "Invalid request." };
  }

  const { data, error } = await supabase
    .from("inquiries")
    .update({ status: parsedStatus.data })
    .eq("id", parsedId.data)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[inquiries] status update failed:", error.code, error.message);
    return { ok: false, error: "The status couldn't be updated. Please try again." };
  }
  if (!data) return { ok: false, error: "Inquiry not found." };
  return { ok: true };
}
