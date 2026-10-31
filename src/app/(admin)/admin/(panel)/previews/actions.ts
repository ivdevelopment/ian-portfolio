"use server";

import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { getPreviewConfig } from "@/lib/preview/config";
import { resolveExpiry } from "@/lib/preview/expiry";
import { validateTargetUrl } from "@/lib/preview/target-url";
import { accessCodeSchema, previewCreateSchema, previewDetailsSchema } from "@/lib/schemas/preview";

type Failure = { ok: false; error: string; fieldErrors?: Record<string, string> };
export type PreviewActionResult<T extends object = object> = ({ ok: true } & T) | Failure;

const idSchema = z.uuid();

function fieldErrors(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): Failure {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !out[key]) out[key] = issue.message;
  }
  return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: out };
}

/** The server repeats the SSRF check with the configured base domain too (the form only knows the static one). */
function checkTarget(targetUrl: string) {
  const { baseDomain } = getPreviewConfig();
  return validateTargetUrl(targetUrl, { blockedDomains: [baseDomain, "ianverlinden.com"] });
}

function mapDbError(error: { code?: string; message: string }): Failure {
  if (error.code === "23505") return { ok: false, error: "That subdomain is already in use.", fieldErrors: { subdomain: "That subdomain is already in use." } };
  if (error.code === "23514") return { ok: false, error: "A value was rejected by the database (check the subdomain and URL)." };
  if (error.code === "42501") return { ok: false, error: "You don't have permission to do that." };
  console.error("[previews] database error:", error.code);
  return { ok: false, error: "That couldn't be saved. Please try again." };
}

/** Creates a preview. The access code is hashed inside the database and is returned to the caller exactly once. */
export async function createPreviewAction(
  input: unknown,
): Promise<PreviewActionResult<{ id: string; subdomain: string; code: string }>> {
  const { supabase } = await requireAdmin();

  const parsed = previewCreateSchema.safeParse(input);
  if (!parsed.success) return fieldErrors(parsed.error);
  const v = parsed.data;

  const target = checkTarget(v.targetUrl);
  if (!target.ok) return { ok: false, error: target.error, fieldErrors: { targetUrl: target.error } };

  const expiresAt = resolveExpiry(v.expiry, new Date());
  if (expiresAt === null && v.expiry.kind === "date") {
    return { ok: false, error: "Pick a valid expiry date.", fieldErrors: { "expiry.date": "Pick a valid date." } };
  }

  const code = v.code.trim();
  const { data, error } = await supabase.rpc("create_client_preview", {
    p_client_name: v.clientName,
    p_project_name: v.projectName,
    p_subdomain: v.subdomain,
    p_target_url: target.value,
    p_code: code,
    p_expires_at: (expiresAt ?? null) as never,
    p_session_ttl_hours: v.sessionTtlHours,
    p_notes: v.notes as never,
  });
  if (error) return mapDbError(error);

  return { ok: true, id: data as string, subdomain: v.subdomain, code };
}

/** Edits everything except the code. Changing the target or subdomain ends existing sessions (database trigger). */
export async function updatePreviewAction(id: string, input: unknown): Promise<PreviewActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Preview not found." };

  const parsed = previewDetailsSchema.safeParse(input);
  if (!parsed.success) return fieldErrors(parsed.error);
  const v = parsed.data;

  const target = checkTarget(v.targetUrl);
  if (!target.ok) return { ok: false, error: target.error, fieldErrors: { targetUrl: target.error } };

  const expiresAt = resolveExpiry(v.expiry, new Date());
  if (expiresAt === null && v.expiry.kind === "date") {
    return { ok: false, error: "Pick a valid expiry date.", fieldErrors: { "expiry.date": "Pick a valid date." } };
  }

  const { error } = await supabase
    .from("client_previews")
    .update({
      client_name: v.clientName,
      project_name: v.projectName,
      subdomain: v.subdomain,
      target_url: target.value,
      session_ttl_hours: v.sessionTtlHours,
      notes: v.notes || null,
      ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}),
    })
    .eq("id", id);
  if (error) return mapDbError(error);
  return { ok: true };
}

/** Replaces the code and invalidates every existing session (session generation is bumped in the database). */
export async function resetPreviewCodeAction(
  id: string,
  code: unknown,
): Promise<PreviewActionResult<{ code: string }>> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Preview not found." };

  const parsed = accessCodeSchema.safeParse(code);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the access code." };

  const value = (parsed.data as string).trim();
  const { error } = await supabase.rpc("reset_preview_access_code", { p_id: id, p_code: value });
  if (error) return error.code === "P0002" ? { ok: false, error: "Preview not found." } : mapDbError(error);
  return { ok: true, code: value };
}

/** Disabling ends all sessions immediately (and permanently: re-enabling needs a fresh login). */
export async function setPreviewActiveAction(id: string, active: boolean): Promise<PreviewActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Preview not found." };
  const { error } = await supabase.from("client_previews").update({ active }).eq("id", id);
  if (error) return mapDbError(error);
  return { ok: true };
}

/** Removes access only. The client's own site, project and deployment are never touched. */
export async function deletePreviewAction(id: string): Promise<PreviewActionResult> {
  const { supabase } = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Preview not found." };
  const { error } = await supabase.from("client_previews").delete().eq("id", id);
  if (error) return mapDbError(error);
  return { ok: true };
}
