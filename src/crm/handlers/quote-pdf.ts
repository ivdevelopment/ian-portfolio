import { z } from "zod";
import { getAdminContext } from "@/lib/auth";
import { quoteFileName } from "@/lib/quotes/constants";
import { renderQuotePdf } from "@/lib/quotes/pdf/render";
import { getQuote, getQuoteSettings } from "@/lib/quotes/queries";

/** "Not found" for everything that is not a signed-in admin asking for a quote that exists: nothing here is guessable or public. */
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });

/**
 * The quote as a PDF, generated on request for the signed-in admin only. `?download=1` sends it as an attachment (and records that
 * a PDF was generated); without it the browser shows it inline for preview. Nothing is stored: there is no file at rest, no public
 * URL and no token to leak. Cross-site requests are refused.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return new Response("Forbidden", { status: 403 });
  const admin = await getAdminContext();
  if (!admin) return notFound();

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return notFound();
  const quote = await getQuote(id);
  if (!quote) return notFound();

  let pdf: Uint8Array;
  try {
    pdf = await renderQuotePdf({ quote, settings: await getQuoteSettings() });
  } catch (error) {
    console.error("[quotes] pdf render failed:", error instanceof Error ? error.message : error);
    return new Response("The PDF could not be generated.", { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }

  const download = new URL(request.url).searchParams.get("download") === "1";
  if (download) {
    const { error } = await admin.supabase.from("quote_activities").insert({ quote_id: quote.id, type: "pdf_generated", title: "PDF downloaded" });
    if (error) console.error("[quotes] pdf activity insert failed:", error.code);
  }

  const name = quoteFileName(quote.number, quote.clientName, quote.clientCompany);
  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(pdf.byteLength),
    },
  });
}
