import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminContext } from "@/lib/auth";
import { EXPORT_FORMATS, prospectsToCsv, prospectsToJson } from "@/lib/prospects/export";
import { parseFilters } from "@/lib/prospects/filters";
import { listActivitiesForProspects, listProspectsByIds, listProspectsForExport } from "@/lib/prospects/queries";
import { isSameOrigin } from "@/lib/prospects/request-guard";
import { brusselsToday } from "@/lib/prospects/dates";
import { buildProspectWorkbook } from "@/lib/prospects/xlsx";

const bodySchema = z.object({
  format: z.enum(EXPORT_FORMATS),
  scope: z.enum(["all", "filtered", "selected"]),
  /** The list's own query string (only used for "filtered"). */
  query: z.string().max(2000).optional(),
  ids: z.array(z.uuid()).max(2000).optional(),
  includeActivities: z.boolean().optional(),
});

const TYPES = {
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

/**
 * Generates the file on the server for the signed-in admin only (POST, same origin): there is no public or
 * guessable export URL. CSV and XLSX text cells are neutralised against spreadsheet formula injection.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await getAdminContext())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid export request." }, { status: 400 });
  const { format, scope, query, ids, includeActivities } = parsed.data;

  if (scope === "selected" && (!ids || ids.length === 0)) return NextResponse.json({ error: "Select at least one prospect." }, { status: 400 });

  // Selection / all / filtered all share one reader, in the list's own order.
  const baseFilters = parseFilters(new URLSearchParams(scope === "filtered" ? (query ?? "") : ""));
  const prospects = scope === "selected" ? await listProspectsByIds(ids!) : await listProspectsForExport(baseFilters);

  // Activity history never goes into a CSV cell: it is a separate sheet (XLSX) or a nested section (JSON).
  const wantActivities = (format === "xlsx" ? includeActivities !== false : Boolean(includeActivities)) && format !== "csv";
  const activities = wantActivities ? await listActivitiesForProspects(prospects.map((p) => p.id)) : undefined;

  const body =
    format === "csv"
      ? prospectsToCsv(prospects)
      : format === "json"
        ? prospectsToJson(prospects, activities)
        : new Uint8Array(await buildProspectWorkbook(prospects, activities));

  return new NextResponse(body, {
    headers: {
      "content-type": TYPES[format],
      "content-disposition": `attachment; filename="prospects-${brusselsToday()}.${format}"`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
      "x-content-type-options": "nosniff",
    },
  });
}
