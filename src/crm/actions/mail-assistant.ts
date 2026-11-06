"use server";

import { requireAdmin } from "@/lib/auth";
import { dismiss, getAssistantView, markUsed, requestRecommendation } from "@/lib/mail-assistant/service";
import type { AssistantView } from "@/lib/mail-assistant/view";
import { idSchema } from "@/lib/schemas/prospect";

/**
 * Mail Assistant server actions. None of them sends mail, and none of them calls Codex directly: "request" only QUEUES a draft for the local
 * Ian Prospect Agent. Reading the view never queues anything, so opening a prospect costs no Codex usage.
 */
export type ViewResult = { ok: true; view: AssistantView } | { ok: false; error: string };

export async function getMailAssistantViewAction(prospectId: unknown): Promise<ViewResult> {
  const { supabase } = await requireAdmin();
  const id = idSchema.safeParse(prospectId);
  if (!id.success) return { ok: false, error: "Prospect not found." };
  const view = await getAssistantView(supabase, id.data);
  return view ? { ok: true, view } : { ok: false, error: "Prospect not found." };
}

export type RequestActionResult = { ok: true; alreadyOpen: boolean } | { ok: false; error: string };

/** Generate / Regenerate / Refresh: queue one draft. A second click while one is open finds the open one instead of queueing another. */
export async function requestMailRecommendationAction(prospectId: unknown, tone?: unknown): Promise<RequestActionResult> {
  const { supabase, userId } = await requireAdmin();
  const id = idSchema.safeParse(prospectId);
  if (!id.success) return { ok: false, error: "Prospect not found." };
  const r = await requestRecommendation(supabase, userId, id.data, new Date(), process.env, tone);
  return r.ok ? { ok: true, alreadyOpen: r.alreadyOpen } : { ok: false, error: r.error };
}

/** "Mark as used": keeps the draft as used and notes it in the history. It never claims a mail was sent and never changes the prospect's status. */
export async function markMailDraftUsedAction(recommendationId: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase } = await requireAdmin();
  const id = idSchema.safeParse(recommendationId);
  if (!id.success) return { ok: false, error: "Draft not found." };
  return markUsed(supabase, id.data);
}

/** "Dismiss" the draft, or cancel a request that is still open. The prospect is not touched. */
export async function dismissMailRecommendationAction(recommendationId: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase } = await requireAdmin();
  const id = idSchema.safeParse(recommendationId);
  if (!id.success) return { ok: false, error: "Draft not found." };
  return dismiss(supabase, id.data);
}
