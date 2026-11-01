/**
 * Maps rows read from the legacy tracker (see parse-pdf.mjs) onto the prospects schema, and builds the
 * idempotent SQL that imports them. Pure functions, no I/O: covered by tests/prospects-legacy.test.ts.
 *
 * Rules (from the migration brief):
 *  - nothing is invented: a blank source cell is NULL;
 *  - statuses are only the ones the source states (Gecontacteerd -> contacted, Reactie ontvangen -> replied);
 *  - dates stay calendar days exactly as written, and follow-ups are never recalculated;
 *  - "Verzending bevestigd?" is kept: Ja -> confirmed, Controleer -> needs_verification, blank -> unknown;
 *  - notes are kept verbatim ("verifieer ..." is never rewritten into a claim that sending was confirmed);
 *  - "Days until follow-up" is derived data and is not stored.
 */

export const SOURCE_LABEL = "Website Prospect CRM (legacy tracker)";
export const SOURCE_FILE = "Website_Prospect_CRM - Prospects.pdf";
export const LEGACY_PREFIX = "website-prospect-crm";

const MONTHS = { jan: 1, feb: 2, mrt: 3, apr: 4, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };
const STATUS = { gecontacteerd: "contacted", "reactie ontvangen": "replied" };
const PRIORITY = { laag: "low", normaal: "normal", hoog: "high", dringend: "urgent" };
const DELIVERY = { ja: "confirmed", controleer: "needs_verification" };

/** "29 okt 2026" -> "2026-10-29". Null for blank; throws for anything that is not a real date. */
export function parseDutchDay(text) {
  if (text === null || text === undefined || String(text).trim() === "") return null;
  const m = /^(\d{1,2})\s+([a-z]{3,})\.?\s+(\d{4})$/i.exec(String(text).trim());
  const month = m && MONTHS[m[2].toLowerCase().slice(0, 3)];
  if (!m || !month) throw new Error(`Unrecognised date "${text}"`);
  const [d, y] = [Number(m[1]), Number(m[3])];
  const probe = new Date(Date.UTC(y, month - 1, d));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== d) throw new Error(`Invalid date "${text}"`);
  return `${y}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const blank = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());

export function parseAmount(text) {
  const t = blank(text);
  if (t === null) return null;
  const n = Number(t.replace(/[€\s]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) throw new Error(`Unrecognised amount "${text}"`);
  return n;
}

/** One source row -> one prospects row (+ the activity its "last action" describes). Throws on unknown vocabulary. */
export function mapLegacyRow(row) {
  const warnings = [];
  const company = blank(row.company);
  if (!company) throw new Error(`Row ${row.legacyId}: company is missing`);

  const statusKey = blank(row.status)?.toLowerCase();
  const status = statusKey ? STATUS[statusKey] : undefined;
  if (!status) throw new Error(`Row ${row.legacyId} (${company}): status "${row.status}" has no mapping`);

  const priorityKey = blank(row.priority)?.toLowerCase();
  const priority = priorityKey ? PRIORITY[priorityKey] : undefined;
  if (!priority) throw new Error(`Row ${row.legacyId} (${company}): priority "${row.priority}" has no mapping`);

  const deliveryKey = blank(row.deliveryConfirmed)?.toLowerCase();
  const delivery = deliveryKey ? DELIVERY[deliveryKey] : "unknown";
  if (!delivery) throw new Error(`Row ${row.legacyId} (${company}): delivery flag "${row.deliveryConfirmed}" has no mapping`);
  if (delivery === "unknown") warnings.push(`${company}: no "Verzending bevestigd?" value in the source; stored as unknown.`);
  if (delivery === "needs_verification") warnings.push(`${company}: source says the sending still needs to be verified ("Controleer").`);

  const email = blank(row.email);
  if (!email) warnings.push(`${company}: no email address in the source.`);

  return {
    legacyRef: `${LEGACY_PREFIX}:${row.legacyId}`,
    legacyId: row.legacyId,
    company_name: company,
    sector: blank(row.sector),
    city: blank(row.city),
    website_url: blank(row.website),
    email,
    contact_name: blank(row.contact),
    status,
    priority,
    first_contact_on: parseDutchDay(row.firstContact),
    last_contact_on: parseDutchDay(row.lastContact),
    next_follow_up_on: parseDutchDay(row.nextFollowUp),
    estimated_value_eur: parseAmount(row.estimatedValue),
    quote_value_eur: parseAmount(row.quote),
    contact_delivery_status: delivery,
    notes: blank(row.notes),
    last_action: blank(row.lastAction),
    warnings,
  };
}

const normalize = (s) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Real duplicates inside the source itself (same company, email or website host). */
export function findSourceDuplicates(rows) {
  const seen = { company: new Map(), email: new Map(), host: new Map() };
  const out = [];
  for (const r of rows) {
    const host = r.website_url ? new URL(r.website_url).hostname.replace(/^www\./, "") : "";
    for (const [kind, key, map] of [
      ["company", normalize(r.company_name), seen.company],
      ["email", (r.email ?? "").toLowerCase(), seen.email],
      ["website", host, seen.host],
    ]) {
      if (!key) continue;
      if (map.has(key)) out.push({ row: r.legacyId, of: map.get(key), kind });
      else map.set(key, r.legacyId);
    }
  }
  return out;
}

/** SQL string literal (standard_conforming_strings): doubles quotes; NUL bytes are rejected. */
export const lit = (v) => {
  if (v === null || v === undefined) return "null";
  const s = String(v);
  if (s.includes("\0")) throw new Error("NUL byte in value");
  return `'${s.replace(/'/g, "''")}'`;
};
const litDate = (v) => (v === null ? "null::date" : `${lit(v)}::date`);
const litNum = (v) => (v === null ? "null::numeric" : String(Number(v)));

/**
 * The whole import as ONE statement (atomic). Re-running it inserts nothing new: rows are keyed by `legacy_ref`
 * (ON CONFLICT DO NOTHING) and the audit row records how many were already present.
 */
export function buildImportSql(mapped, report) {
  const values = mapped
    .map(
      (r) =>
        `(${[
          lit(r.legacyRef),
          lit(r.company_name),
          lit(r.sector),
          lit(r.city),
          lit(r.website_url),
          lit(r.email),
          lit(r.contact_name),
          lit(r.status),
          lit(r.priority),
          litDate(r.first_contact_on),
          litDate(r.last_contact_on),
          litDate(r.next_follow_up_on),
          litNum(r.estimated_value_eur),
          litNum(r.quote_value_eur),
          lit(r.contact_delivery_status),
          lit(r.notes),
          lit(r.last_action),
        ].join(", ")})`,
    )
    .join(",\n  ");

  return `-- Legacy prospect migration (${mapped.length} rows). Idempotent: keyed by legacy_ref.
with src (legacy_ref, company_name, sector, city, website_url, email, contact_name, status, priority,
          first_contact_on, last_contact_on, next_follow_up_on, estimated_value_eur, quote_value_eur,
          contact_delivery_status, notes, last_action) as (
  values
  ${values}
),
already as (
  select count(*)::int as n from src s where exists (select 1 from public.prospects p where p.legacy_ref = s.legacy_ref)
),
ins as (
  insert into public.prospects (
    legacy_ref, company_name, sector, city, website_url, email, contact_name, status, priority,
    first_contact_on, last_contact_on, next_follow_up_on, estimated_value_eur, quote_value_eur,
    contact_delivery_status, notes, source
  )
  select legacy_ref, company_name, sector, city, website_url, email, contact_name, status, priority,
         first_contact_on, last_contact_on, next_follow_up_on, estimated_value_eur, quote_value_eur,
         contact_delivery_status, notes, ${lit(SOURCE_LABEL)}
    from src
  on conflict (legacy_ref) do nothing
  returning id, legacy_ref
),
act as (
  insert into public.prospect_activities (prospect_id, type, title, description, occurred_on, metadata)
  select ins.id, 'other', src.last_action,
         'Last action recorded in the legacy tracker (Laatste actie).',
         coalesce(src.last_contact_on, (now() at time zone 'Europe/Brussels')::date),
         jsonb_build_object('legacy_ref', src.legacy_ref, 'imported', true)
    from ins join src on src.legacy_ref = ins.legacy_ref
   where src.last_action is not null
  returning 1
),
audit as (
  insert into public.prospect_imports (source, file_name, rows_parsed, rows_imported, rows_skipped, duplicates, warnings)
  select ${lit("legacy PDF migration")}, ${lit(SOURCE_FILE)}, ${report.parsed},
         (select count(*) from ins), ${report.parsed} - (select count(*) from ins),
         (select n from already) + ${report.sourceDuplicates},
         ${lit(JSON.stringify(report.warnings))}::jsonb
   -- A re-run that changes nothing leaves no new audit entry.
   where (select count(*) from ins) > 0
  returning id
)
select (select count(*) from ins) as imported,
       (select n from already) as already_present,
       (select count(*) from act) as activities,
       (select count(*) from audit) as audit_rows;
`;
}

/** Links the migrated Geert Kips prospect to the existing preview, only when exactly one of each exists. */
export function buildGeertLinkSql() {
  return `-- Link Geert Kips to the existing client preview (only if unambiguous; the preview itself is never touched).
with prospect as (
  select id from public.prospects where legacy_ref like ${lit(`${LEGACY_PREFIX}:%`)} and lower(company_name) = 'geert kips' and linked_preview_id is null
),
preview as (
  select id, subdomain from public.client_previews where subdomain = 'geertkips'
),
ok as (
  select (select id from prospect) as prospect_id, (select id from preview) as preview_id
   where (select count(*) from prospect) = 1 and (select count(*) from preview) = 1
),
linked as (
  update public.prospects p set linked_preview_id = ok.preview_id from ok where p.id = ok.prospect_id returning p.id
),
logged as (
  insert into public.prospect_activities (prospect_id, type, title, description, metadata)
  select id, 'preview_linked', 'Client preview linked', 'geertkips', jsonb_build_object('subdomain', 'geertkips') from linked
  returning 1
)
select (select count(*) from linked) as linked, (select count(*) from prospect) as prospect_candidates, (select count(*) from preview) as preview_candidates;
`;
}
