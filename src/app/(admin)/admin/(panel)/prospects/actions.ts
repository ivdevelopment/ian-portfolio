"use server";

import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import {
  MANUAL_ACTIVITY_TYPES,
  PROSPECT_PRIORITIES,
  PROSPECT_STATUSES,
  type ActivityType,
} from "@/lib/prospects/constants";
import { brusselsToday, isIsoDay } from "@/lib/prospects/dates";
import {
  followUpDoneActivity,
  followUpSetActivity,
  projectDraftFromProspect,
  quickActionPatch,
  type ActivityDraft,
  type QuickAction,
} from "@/lib/prospects/events";
import { idListSchema, idSchema, toProspectRow, validateProspectForm } from "@/lib/schemas/prospect";

type Failure = { ok: false; error: string; fieldErrors?: Record<string, string> };
export type ProspectActionResult<T extends object = object> = ({ ok: true } & T) | Failure;

const MESSAGES: Record<string, string> = {
  "23514": "A value was rejected by the database. Check the fields and try again.",
  "42501": "You don't have permission to do that.",
  "23503": "That linked record no longer exists.",
};

function dbFailure(error: { code?: string; message: string }): Failure {
  if (!MESSAGES[error.code ?? ""]) console.error("[prospects] database error:", error.code, error.message);
  return { ok: false, error: MESSAGES[error.code ?? ""] ?? "That couldn't be saved. Please try again." };
}

const notFound: Failure = { ok: false, error: "Prospect not found." };

async function logActivity(
  supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"],
  prospectId: string,
  draft: ActivityDraft & { metadata?: Record<string, unknown> },
) {
  const { error } = await supabase.from("prospect_activities").insert({
    prospect_id: prospectId,
    type: draft.type,
    title: draft.title.slice(0, 200),
    description: draft.description ?? null,
    ...(draft.occurred_on ? { occurred_on: draft.occurred_on } : {}),
    metadata: (draft.metadata ?? {}) as never,
  });
  if (error) console.error("[prospects] activity insert failed:", error.code);
}

/* ------------------------------ create / edit ------------------------------ */

export async function createProspectAction(input: unknown): Promise<ProspectActionResult<{ id: string }>> {
  const { supabase } = await requireAdmin();
  const checked = validateProspectForm(input);
  if (!checked.ok) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: checked.errors };

  const { data, error } = await supabase.from("prospects").insert(toProspectRow(checked.data)).select("id").single();
  if (error) return dbFailure(error);
  return { ok: true, id: data.id };
}

export async function updateProspectAction(id: string, input: unknown): Promise<ProspectActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return notFound;
  const checked = validateProspectForm(input);
  if (!checked.ok) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: checked.errors };

  const today = brusselsToday();
  const { data: before } = await supabase.from("prospects").select("next_follow_up_on").eq("id", id).maybeSingle();
  if (!before) return notFound;

  const { error } = await supabase.from("prospects").update(toProspectRow(checked.data)).eq("id", id);
  if (error) return dbFailure(error);

  // Status changes are logged by the database; a changed follow-up date is logged here.
  const followUp = followUpSetActivity(checked.data.nextFollowUpOn, before.next_follow_up_on, today);
  if (followUp) await logActivity(supabase, id, { ...followUp, metadata: { on: checked.data.nextFollowUpOn } });
  return { ok: true };
}

export async function updateNotesAction(id: string, notes: unknown): Promise<ProspectActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return notFound;
  const parsed = z.string().max(10000, "Keep the notes under 10,000 characters.").safeParse(notes);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { error } = await supabase.from("prospects").update({ notes: parsed.data.trim() || null }).eq("id", id);
  return error ? dbFailure(error) : { ok: true };
}

/* ------------------------------ status, priority, follow-up ------------------------------ */

export async function setStatusAction(id: string, status: unknown): Promise<ProspectActionResult> {
  const { supabase } = await requireAdmin();
  const parsed = z.enum(PROSPECT_STATUSES).safeParse(status);
  if (!idSchema.safeParse(id).success || !parsed.success) return notFound;
  const { error } = await supabase.from("prospects").update({ status: parsed.data }).eq("id", id);
  return error ? dbFailure(error) : { ok: true };
}

export async function setPriorityAction(id: string, priority: unknown): Promise<ProspectActionResult> {
  const { supabase } = await requireAdmin();
  const parsed = z.enum(PROSPECT_PRIORITIES).safeParse(priority);
  if (!idSchema.safeParse(id).success || !parsed.success) return notFound;
  const { error } = await supabase.from("prospects").update({ priority: parsed.data }).eq("id", id);
  return error ? dbFailure(error) : { ok: true };
}

const dayOrNull = z.union([z.null(), z.string().refine(isIsoDay, "Pick a valid date.")]);

export async function setFollowUpAction(id: string, day: unknown): Promise<ProspectActionResult> {
  const { supabase } = await requireAdmin();
  const parsed = dayOrNull.safeParse(day);
  if (!idSchema.safeParse(id).success) return notFound;
  if (!parsed.success) return { ok: false, error: "Pick a valid date." };

  const { data: before } = await supabase.from("prospects").select("next_follow_up_on").eq("id", id).maybeSingle();
  if (!before) return notFound;
  const { error } = await supabase.from("prospects").update({ next_follow_up_on: parsed.data }).eq("id", id);
  if (error) return dbFailure(error);

  const activity = followUpSetActivity(parsed.data, before.next_follow_up_on, brusselsToday());
  if (activity) await logActivity(supabase, id, { ...activity, metadata: { on: parsed.data } });
  return { ok: true };
}

/** Marks the current follow-up done (an event), optionally scheduling the next one. */
export async function completeFollowUpAction(id: string, nextDay: unknown): Promise<ProspectActionResult> {
  const { supabase } = await requireAdmin();
  const parsed = dayOrNull.safeParse(nextDay ?? null);
  if (!idSchema.safeParse(id).success) return notFound;
  if (!parsed.success) return { ok: false, error: "Pick a valid date." };

  const today = brusselsToday();
  const { data: before } = await supabase.from("prospects").select("next_follow_up_on").eq("id", id).maybeSingle();
  if (!before) return notFound;
  if (!before.next_follow_up_on) return { ok: false, error: "This prospect has no follow-up to complete." };

  const { error } = await supabase
    .from("prospects")
    .update({ next_follow_up_on: parsed.data, last_contact_on: today })
    .eq("id", id);
  if (error) return dbFailure(error);

  await logActivity(supabase, id, {
    ...followUpDoneActivity(today),
    metadata: { was_due: before.next_follow_up_on, next: parsed.data },
  });
  return { ok: true };
}

export async function quickAction(id: string, action: QuickAction): Promise<ProspectActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success || !["mark_contacted", "reply_received", "mark_won", "mark_lost"].includes(action)) return notFound;

  const { data: current } = await supabase.from("prospects").select("status, first_contact_on, last_contact_on").eq("id", id).maybeSingle();
  if (!current) return notFound;

  const today = brusselsToday();
  const { patch, activity } = quickActionPatch(action, current as never, today);
  const { error } = await supabase.from("prospects").update(patch as never).eq("id", id);
  if (error) return dbFailure(error);
  if (activity) await logActivity(supabase, id, activity);
  return { ok: true };
}

const activitySchema = z.object({
  type: z.enum(MANUAL_ACTIVITY_TYPES.map((t) => t.value) as [ActivityType, ...ActivityType[]]),
  title: z.string().trim().min(1, "Enter a title.").max(200, "Keep the title under 200 characters."),
  description: z.string().trim().max(5000, "Keep the description under 5000 characters.").optional(),
  occurredOn: z.string().refine(isIsoDay, "Pick a valid date.").optional(),
});

export async function addActivityAction(id: string, input: unknown): Promise<ProspectActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return notFound;
  const parsed = activitySchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const { error } = await supabase.from("prospect_activities").insert({
    prospect_id: id,
    type: parsed.data.type,
    title: parsed.data.title,
    description: parsed.data.description || null,
    ...(parsed.data.occurredOn ? { occurred_on: parsed.data.occurredOn } : {}),
  });
  return error ? dbFailure(error) : { ok: true };
}

/* ------------------------------ delete ------------------------------ */

/** Removes the prospect and its activity history only. Linked projects and previews are never touched (FK is SET NULL). */
export async function deleteProspectAction(id: string): Promise<ProspectActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return notFound;
  const { error } = await supabase.from("prospects").delete().eq("id", id);
  return error ? dbFailure(error) : { ok: true };
}

/* ------------------------------ bulk ------------------------------ */

export async function bulkUpdateAction(
  ids: unknown,
  change:
    | { kind: "status"; status: unknown }
    | { kind: "priority"; priority: unknown }
    | { kind: "follow_up"; day: unknown },
): Promise<ProspectActionResult<{ count: number }>> {
  const { supabase } = await requireAdmin();
  const list = idListSchema.safeParse(ids);
  if (!list.success) return { ok: false, error: "Select at least one prospect." };

  let patch: Record<string, unknown>;
  if (change.kind === "status") {
    const s = z.enum(PROSPECT_STATUSES).safeParse(change.status);
    if (!s.success) return { ok: false, error: "Pick a status." };
    patch = { status: s.data };
  } else if (change.kind === "priority") {
    const p = z.enum(PROSPECT_PRIORITIES).safeParse(change.priority);
    if (!p.success) return { ok: false, error: "Pick a priority." };
    patch = { priority: p.data };
  } else {
    const d = dayOrNull.safeParse(change.day);
    if (!d.success) return { ok: false, error: "Pick a valid date." };
    patch = { next_follow_up_on: d.data };
  }

  const { data, error } = await supabase.from("prospects").update(patch as never).in("id", list.data).select("id");
  if (error) return dbFailure(error);

  if (change.kind === "follow_up") {
    const today = brusselsToday();
    const draft = followUpSetActivity(patch.next_follow_up_on as string | null, "", today);
    if (draft) {
      await supabase.from("prospect_activities").insert(
        (data ?? []).map((r) => ({ prospect_id: r.id, type: draft.type, title: draft.title, occurred_on: today, metadata: { on: patch.next_follow_up_on, bulk: true } as never })),
      );
    }
  }
  return { ok: true, count: data?.length ?? 0 };
}

export async function bulkDeleteAction(ids: unknown): Promise<ProspectActionResult<{ count: number }>> {
  const { supabase } = await requireAdmin();
  const list = idListSchema.safeParse(ids);
  if (!list.success) return { ok: false, error: "Select at least one prospect." };
  const { data, error } = await supabase.from("prospects").delete().in("id", list.data).select("id");
  return error ? dbFailure(error) : { ok: true, count: data?.length ?? 0 };
}

/* ------------------------------ linking ------------------------------ */

export async function linkPreviewAction(id: string, previewId: unknown): Promise<ProspectActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return notFound;
  if (previewId === null) {
    const { error } = await supabase.from("prospects").update({ linked_preview_id: null }).eq("id", id);
    if (error) return dbFailure(error);
    await logActivity(supabase, id, { type: "preview_unlinked", title: "Client preview unlinked" });
    return { ok: true };
  }
  const pid = idSchema.safeParse(previewId);
  if (!pid.success) return { ok: false, error: "Pick a client preview." };
  const { data: preview } = await supabase.from("client_previews").select("subdomain").eq("id", pid.data).maybeSingle();
  if (!preview) return { ok: false, error: "That client preview no longer exists." };

  const { error } = await supabase.from("prospects").update({ linked_preview_id: pid.data }).eq("id", id);
  if (error) return dbFailure(error);
  await logActivity(supabase, id, { type: "preview_linked", title: "Client preview linked", description: preview.subdomain, metadata: { subdomain: preview.subdomain } });
  return { ok: true };
}

export async function linkProjectAction(id: string, projectId: unknown): Promise<ProspectActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return notFound;
  if (projectId === null) {
    const { error } = await supabase.from("prospects").update({ linked_project_id: null }).eq("id", id);
    return error ? dbFailure(error) : { ok: true };
  }
  const pid = idSchema.safeParse(projectId);
  if (!pid.success) return { ok: false, error: "Pick a project." };
  const { data: project } = await supabase.from("projects").select("title").eq("id", pid.data).maybeSingle();
  if (!project) return { ok: false, error: "That project no longer exists." };

  const { error } = await supabase.from("prospects").update({ linked_project_id: pid.data }).eq("id", id);
  if (error) return dbFailure(error);
  await logActivity(supabase, id, { type: "project_linked", title: "Project linked", description: project.title });
  return { ok: true };
}

/**
 * "Convert to project": explicit, one click. Marks the prospect won, creates an UNPUBLISHED project draft from
 * the facts the prospect holds, and links it back. Nothing is published and no content is invented.
 */
export async function convertToProjectAction(id: string): Promise<ProspectActionResult<{ projectId: string }>> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return notFound;

  const { data: prospect } = await supabase
    .from("prospects")
    .select("id, company_name, sector, website_url, status, linked_project_id")
    .eq("id", id)
    .maybeSingle();
  if (!prospect) return notFound;
  if (prospect.linked_project_id) return { ok: false, error: "This prospect already has a linked project." };

  const { data: slugs } = await supabase.from("projects").select("slug");
  const draft = projectDraftFromProspect(prospect as never, (slugs ?? []).map((s) => s.slug));
  const { data: project, error } = await supabase.from("projects").insert(draft).select("id").single();
  if (error) return dbFailure(error);

  const { error: linkError } = await supabase
    .from("prospects")
    .update({ linked_project_id: project.id, status: "won" })
    .eq("id", id);
  if (linkError) return dbFailure(linkError);

  await logActivity(supabase, id, {
    type: "project_created",
    title: "Project draft created",
    description: draft.title,
    metadata: { project_id: project.id, slug: draft.slug },
  });
  return { ok: true, projectId: project.id };
}
