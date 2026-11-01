import { NextResponse } from "next/server";
import { getAdminContext } from "@/lib/auth";
import { autoMapColumns, commit, evaluate, ImportError, parseMapping, readUpload } from "@/lib/prospects/import-service";
import { isSameOrigin } from "@/lib/prospects/request-guard";

/**
 * Import endpoint for the wizard (multipart: file + step). Stateless: the file is re-read on every step, so
 * nothing about an upload is stored between requests. Admin only.
 *   step=parse     -> headers, sample rows and a suggested column mapping
 *   step=validate  -> per-row validation and duplicate report
 *   step=commit    -> inserts the confirmed rows and writes the audit record
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await getAdminContext())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to import." }, { status: 400 });
    const step = String(form.get("step") ?? "");
    const sheet = await readUpload(file);

    if (step === "parse") {
      return NextResponse.json({
        fileName: sheet.fileName,
        headers: sheet.headers,
        sample: sheet.rows.slice(0, 5),
        rowCount: sheet.rows.length,
        mapping: autoMapColumns(sheet.headers),
      });
    }

    let rawMapping: unknown = null;
    try {
      rawMapping = JSON.parse(String(form.get("mapping") ?? "{}"));
    } catch {
      return NextResponse.json({ error: "The column mapping is invalid." }, { status: 400 });
    }
    const mapping = parseMapping(rawMapping, sheet.headers.length);
    if (mapping.companyName === undefined || mapping.companyName === null) {
      return NextResponse.json({ error: "Map the Company column first." }, { status: 400 });
    }

    if (step === "validate") {
      const { report } = await evaluate(sheet, mapping);
      return NextResponse.json(report);
    }
    if (step === "commit") {
      let importRows: unknown = [];
      try {
        importRows = JSON.parse(String(form.get("importDuplicates") ?? "[]"));
      } catch {
        importRows = [];
      }
      const allowed = new Set(Array.isArray(importRows) ? importRows.filter((n): n is number => Number.isInteger(n)) : []);
      return NextResponse.json(await commit(sheet, mapping, allowed));
    }
    return NextResponse.json({ error: "Unknown step." }, { status: 400 });
  } catch (error) {
    if (error instanceof ImportError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[prospects] import failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The import failed. Please try again." }, { status: 500 });
  }
}
