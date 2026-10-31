/**
 * One-time migration of the legacy prospect tracker into the CRM.
 *
 *   node scripts/prospects-legacy/import.mjs                  # dry run: parse, validate, print the report (no database)
 *   node scripts/prospects-legacy/import.mjs --apply local    # insert into the local Supabase
 *   node scripts/prospects-legacy/import.mjs --apply linked   # insert into the hosted (linked) Supabase
 *
 * Needs scripts/prospects-legacy/data/prospects-legacy.json (git-ignored; made by parse-pdf.mjs).
 * Safe to re-run: rows are keyed by legacy_ref, so nothing is duplicated. Never prints email addresses.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGeertLinkSql, buildImportSql, findSourceDuplicates, mapLegacyRow } from "./legacy-map.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dataFile = join(here, "data", "prospects-legacy.json");
const EXPECTED = 35;

const args = process.argv.slice(2);
const applyIndex = args.indexOf("--apply");
const target = applyIndex === -1 ? null : args[applyIndex + 1];
if (applyIndex !== -1 && !["local", "linked"].includes(target)) {
  console.error('Use "--apply local" or "--apply linked".');
  process.exit(1);
}
if (!existsSync(dataFile)) {
  console.error("Missing data/prospects-legacy.json. Run parse-pdf.mjs first.");
  process.exit(1);
}

const source = JSON.parse(readFileSync(dataFile, "utf8"));
const mapped = source.map(mapLegacyRow);
const dupes = findSourceDuplicates(mapped);
const warnings = mapped.flatMap((r) => r.warnings);

const count = (key) => mapped.reduce((acc, r) => ({ ...acc, [r[key] ?? "(blank)"]: (acc[r[key] ?? "(blank)"] ?? 0) + 1 }), {});
const report = { parsed: source.length, sourceDuplicates: dupes.length, warnings };

console.log("=== Legacy prospect migration report ===");
console.log(`Rows parsed:           ${report.parsed} (expected ${EXPECTED})`);
console.log(`Duplicates in source:  ${dupes.length}${dupes.length ? ` ${JSON.stringify(dupes)}` : ""}`);
console.log(`Statuses:              ${JSON.stringify(count("status"))}`);
console.log(`Priorities:            ${JSON.stringify(count("priority"))}`);
console.log(`Sending (delivery):    ${JSON.stringify(count("contact_delivery_status"))}`);
console.log(`First contact:         ${JSON.stringify(count("first_contact_on"))}`);
console.log(`Last contact:          ${JSON.stringify(count("last_contact_on"))}`);
console.log(`Next follow-up:        ${JSON.stringify(count("next_follow_up_on"))}`);
console.log(`With email / website:  ${mapped.filter((r) => r.email).length} / ${mapped.filter((r) => r.website_url).length}`);
console.log(`With estimated value:  ${mapped.filter((r) => r.estimated_value_eur !== null).length}, with quote: ${mapped.filter((r) => r.quote_value_eur !== null).length}`);
console.log(`With notes:            ${mapped.filter((r) => r.notes).length}, with last action: ${mapped.filter((r) => r.last_action).length}`);
console.log(`Warnings:              ${warnings.length} (blank email: ${warnings.filter((w) => w.includes("no email")).length}, verify sending: ${warnings.filter((w) => w.includes("Controleer")).length})`);
console.log(`Companies:             ${mapped.map((r) => r.company_name).join("; ")}`);

if (report.parsed !== EXPECTED) {
  console.error(`\nSTOP: parsed ${report.parsed} rows but ${EXPECTED} were expected. Not importing.`);
  process.exit(2);
}
if (dupes.length > 0) {
  console.error("\nSTOP: the source contains duplicates. Review them before importing.");
  process.exit(2);
}

const sql = buildImportSql(mapped, report);
writeFileSync(join(here, "data", "import.sql"), sql);
writeFileSync(join(here, "data", "link-geert.sql"), buildGeertLinkSql());

if (!target) {
  console.log("\nDry run only: nothing was written to any database. SQL saved to data/import.sql (git-ignored).");
  process.exit(0);
}

const run = (file) =>
  execFileSync("npx", ["--yes", "supabase@latest", "db", "query", target === "linked" ? "--linked" : "--local", "-f", `"${file}"`], {
    encoding: "utf8",
    shell: true,
  });
console.log(`\nApplying to the ${target} database…`);
console.log(run(join(here, "data", "import.sql")).replace(/"email"[^\n]*/g, ""));
console.log("Linking Geert Kips to the existing preview (if unambiguous)…");
console.log(run(join(here, "data", "link-geert.sql")));
