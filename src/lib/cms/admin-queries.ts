import "server-only";

import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { PROJECT_SELECT, type ProjectRow } from "./mappers";

/** One project for the admin (any status), or null when the id is invalid/missing. */
export async function loadProjectForAdmin(id: string): Promise<ProjectRow | null> {
  const { supabase } = await requireAdmin();
  if (!z.uuid().safeParse(id).success) return null;

  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[admin] failed to load project:", error.message);
    throw new Error("Project unavailable");
  }
  return data as ProjectRow | null;
}
