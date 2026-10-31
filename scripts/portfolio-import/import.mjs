#!/usr/bin/env node
/**
 * Imports the concept sites into the CMS (projects, project_media,
 * project_features, translations, project-media Storage). Safe to re-run: see
 * plan.mjs for how records are identified. Re-running restores the imported
 * fields of these nine projects, so later admin edits to them are overwritten.
 *
 *   npm run portfolio:import:local                 # local Supabase stack
 *   npm run portfolio:import -- --remote           # hosted project (.env.local)
 *   ... -- --dry-run                               # report only, writes nothing
 *   ... -- --rollback --yes                        # remove exactly what this tool imported
 *   ... -- --manifest <path>                       # defaults to Portfolio Assets
 *
 * Writes use the service-role key because save_project() requires a signed-in
 * admin; they touch the same tables, and only rows whose id the plan derives.
 * Before writing, the current project list is saved beside the manifest
 * (import-backups/), and afterwards every other project is compared with it.
 * Public pages show the result after the next deployment, or within the hour.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { CONCEPTS } from "./curation.mjs";
import { DEFAULT_MANIFEST, buildPlan, projectIdFor, readManifest } from "./plan.mjs";

const BUCKET = "project-media";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}
const host = new URL(url).host;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url) && !flag("--remote")) {
  console.error(`Refusing: ${host} is not a local Supabase stack. Add --remote to proceed.`);
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const dryRun = flag("--dry-run");
const manifestPath = option("--manifest") ?? DEFAULT_MANIFEST;
const backupDir = join(dirname(manifestPath), "import-backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

function check(result, what) {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

const allProjects = async () =>
  check(
    await supabase.from("projects").select("*, project_media(*), project_features(*)").order("sort_order"),
    "Reading projects",
  );

async function storedFiles(projectId) {
  const list = check(await supabase.storage.from(BUCKET).list(`projects/${projectId}`, { limit: 1000 }), "Listing files");
  return list.map((f) => `projects/${projectId}/${f.name}`);
}

function saveJson(name, value) {
  mkdirSync(backupDir, { recursive: true });
  const file = join(backupDir, `${name}-${stamp}.json`);
  writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

async function rollback() {
  if (!flag("--yes")) {
    console.error("Rollback deletes the imported projects and their files. Add --yes to proceed.");
    process.exit(1);
  }
  const ids = CONCEPTS.map((c) => projectIdFor(c.slug));
  console.log(`Saved: ${saveJson("before-rollback", await allProjects())}`);
  for (const id of ids) {
    const files = await storedFiles(id);
    if (files.length > 0) check(await supabase.storage.from(BUCKET).remove(files), "Removing files");
    check(await supabase.from("projects").delete().eq("id", id), "Deleting project");
    console.log(`Removed ${id} and ${files.length} file(s).`);
  }
}

async function importAll() {
  const plan = await buildPlan(readManifest(manifestPath));
  const planned = new Map(plan.map((p) => [p.row.id, p]));
  const before = await allProjects();

  for (const { row } of plan) {
    const clash = before.find((p) => p.slug === row.slug && p.id !== row.id);
    if (clash) throw new Error(`Slug "${row.slug}" belongs to a project this tool did not import (${clash.id}). Nothing was changed.`);
  }

  console.log(`Target: ${host}${dryRun ? " (dry run)" : ""}`);
  if (dryRun) {
    for (const { row, media } of plan) {
      const exists = before.some((p) => p.id === row.id);
      console.log(`${exists ? "update" : "create"} ${row.slug} (sort ${row.sort_order}, ${media.length} images)`);
    }
    return;
  }

  console.log(`Saved: ${saveJson("before-import", before)}`);
  const ledger = [];

  for (const { row, translationNl, features, media } of plan) {
    const existing = before.find((p) => p.id === row.id);
    const onDisk = new Set(await storedFiles(row.id));
    const wanted = new Set(media.map((m) => m.storagePath));

    let uploaded = 0;
    for (const m of media) {
      if (onDisk.has(m.storagePath)) continue;
      check(
        await supabase.storage.from(BUCKET).upload(m.storagePath, readFileSync(m.localPath), {
          contentType: "image/webp",
          cacheControl: "31536000",
          upsert: false,
        }),
        `Uploading ${m.localPath}`,
      );
      uploaded++;
    }

    // Other languages already on the row are kept; Dutch is the imported version.
    const translations = { ...(existing?.translations ?? {}), nl: translationNl };
    check(await supabase.from("projects").upsert({ ...row, translations }), `Saving ${row.slug}`);

    check(await supabase.from("project_features").delete().eq("project_id", row.id), "Replacing features");
    check(
      await supabase
        .from("project_features")
        .insert(features.map((label, i) => ({ project_id: row.id, label, sort_order: i }))),
      "Replacing features",
    );

    check(
      await supabase.from("project_media").upsert(
        media.map((m, i) => ({
          id: m.id,
          project_id: row.id,
          type: "image",
          storage_path: m.storagePath,
          external_url: null,
          alt: m.alt,
          poster_path: null,
          sort_order: i,
        })),
      ),
      "Saving media",
    );
    const keptIds = media.map((m) => m.id);
    check(
      await supabase.from("project_media").delete().eq("project_id", row.id).not("id", "in", `(${keptIds.join(",")})`),
      "Removing old media rows",
    );

    const stale = [...onDisk].filter((path) => !wanted.has(path));
    if (stale.length > 0) check(await supabase.storage.from(BUCKET).remove(stale), "Removing old files");

    const action = existing ? "updated" : "created";
    ledger.push({ id: row.id, slug: row.slug, action, uploaded, removedFiles: stale, files: [...wanted] });
    console.log(`${action.padEnd(7)} ${row.slug.padEnd(14)} ${row.id}  uploaded ${uploaded}/${media.length}, removed ${stale.length}`);
  }

  // Everything this tool does not own must be exactly as it was.
  const untouched = (rows) => JSON.stringify(rows.filter((p) => !planned.has(p.id)));
  if (untouched(before) !== untouched(await allProjects())) {
    throw new Error("Another project changed during the import: compare with the saved backup.");
  }
  console.log(`Other projects unchanged: ${before.filter((p) => !planned.has(p.id)).length}`);
  console.log(`Saved: ${saveJson("import-ledger", ledger)}`);
}

await (flag("--rollback") ? rollback() : importAll());
