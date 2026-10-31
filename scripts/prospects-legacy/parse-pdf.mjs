/**
 * One-time reader for the legacy "Website_Prospect_CRM - Prospects.pdf" (a Google Sheets print-out).
 * The sheet was printed in column blocks, so the same rows appear on several pages; this rebuilds each row
 * from the pieces. It never invents data: a blank cell stays null.
 *
 *   npm i --no-save pdfjs-dist@4.10.38
 *   node scripts/prospects-legacy/parse-pdf.mjs "<path to the PDF>"
 *
 * Writes scripts/prospects-legacy/data/prospects-legacy.json (git-ignored: real business contacts).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = process.argv[2];
if (!source) {
  console.error("Usage: node parse-pdf.mjs <pdf>");
  process.exit(1);
}

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(source)) }).promise;

const pages = [];
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  pages.push(content.items.filter((i) => i.str.trim()).map((i) => ({ s: i.str.trim(), x: Math.round(i.transform[4]), y: Math.round(i.transform[5]) })));
}

/** Which column block a page belongs to, by its header row. */
const BLOCKS = [
  { id: "b1", marker: "Bedrijf" },
  { id: "b2", marker: "E-mailadres" },
  { id: "b3", marker: "Volgende opvolging" },
  { id: "b4", marker: "Notities" },
];
const blockOf = (items) => BLOCKS.find((b) => items.some((i) => i.s === b.marker))?.id ?? null;

const byBlock = { b1: [], b2: [], b3: [], b4: [] };
for (const items of pages) {
  const id = blockOf(items);
  if (id) byBlock[id].push(items);
}
const rowPages = byBlock.b1.length;
for (const id of Object.keys(byBlock)) {
  if (byBlock[id].length !== rowPages) throw new Error(`Block ${id} has ${byBlock[id].length} pages, expected ${rowPages}.`);
}

/** Header y and header cell positions of a page. */
function header(items, firstMarker) {
  const marker = items.find((i) => i.s === firstMarker);
  const y = marker.y;
  return { y, cells: items.filter((i) => Math.abs(i.y - y) <= 8 && i.y >= y - 8).sort((a, b) => a.x - b.x) };
}

/** Column a data item falls in: the right-most header cell that starts at or before it (cells may be right-aligned). */
function columnOf(item, cells) {
  let hit = cells[0];
  for (const c of cells) if (c.x <= item.x + 1) hit = c;
  return hit.s;
}

const rows = new Map(); // key "page:y" -> record
const touch = (k) => {
  if (!rows.has(k)) rows.set(k, { key: k });
  return rows.get(k);
};

BLOCKS.forEach(({ id, marker }) => {
  byBlock[id].forEach((items, pageIndex) => {
    const head = header(items, marker);
    // Two-line header ("Dagen tot / opvolging") sits above the data: everything strictly below the header line is data.
    const cells = items.filter((i) => i.y >= head.y - 8 && i.y <= head.y + 14);
    const data = items.filter((i) => i.y < head.y - 8);
    for (const item of data) {
      const row = touch(`${String(pageIndex).padStart(3, "0")}:${String(10000 - item.y).padStart(5, "0")}`);
      (row[id] ??= []).push({ col: columnOf(item, cells.length ? cells : head.cells), text: item.s });
    }
  });
});

const ordered = [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
const cell = (r, block, col) => r[block]?.filter((c) => c.col === col).map((c) => c.text).join(" ") || null;

const records = [];
for (const r of ordered) {
  const first = r.b1?.find((c) => /^\d+\s+/.test(c.text));
  const idMatch = first && /^(\d+)\s+(.+)$/.exec(first.text);
  if (!idMatch) continue; // a spacer row of the sheet, no company

  // "Days until follow-up" is derived (and stale); it shares a text run with the delivery flag ("5 Ja").
  const delivery = (r.b3 ?? []).map((c) => /(Ja|Controleer)/.exec(c.text)?.[1]).find(Boolean) ?? null;

  records.push({
    legacyId: Number(idMatch[1]),
    company: idMatch[2],
    sector: cell(r, "b1", "Sector"),
    city: cell(r, "b1", "Stad"),
    website: cell(r, "b1", "Website"),
    email: cell(r, "b2", "E-mailadres"),
    contact: cell(r, "b2", "Contactpersoon"),
    status: cell(r, "b2", "Status"),
    priority: cell(r, "b2", "Prioriteit"),
    firstContact: cell(r, "b2", "Eerste contact"),
    lastContact: cell(r, "b3", "Laatste contact"),
    nextFollowUp: cell(r, "b3", "Volgende opvolging"),
    deliveryConfirmed: delivery,
    estimatedValue: cell(r, "b3", "Geschatte waarde (€)"),
    quote: cell(r, "b3", "Offerte (€)"),
    notes: cell(r, "b4", "Notities"),
    lastAction: cell(r, "b4", "Laatste actie"),
  });
}

mkdirSync(join(here, "data"), { recursive: true });
writeFileSync(join(here, "data", "prospects-legacy.json"), JSON.stringify(records, null, 2));
console.log(`Parsed ${records.length} prospects from ${doc.numPages} PDF pages -> scripts/prospects-legacy/data/prospects-legacy.json`);
