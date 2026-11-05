import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HeartbeatBusinessData } from "../../../../src/lib/prospecting/agent/business-data";
import { agentHome } from "../paths";
import { buildIndex, openIndex, readMeta, SCHEMA_VERSION, type BuildStats } from "./index-db";
import { ATTRIBUTION, downloadPbf, fetchRemoteInfo, freshness, FRESH_DAYS, GEOFABRIK_URL, SOURCE_NAME, type DownloadResult, type Freshness, type RemoteInfo } from "./geofabrik";

/**
 * Where the local business data lives and how it is kept up to date. Everything is under %LOCALAPPDATA%\IanProspectAgent\data\osm\ (never in the
 * repository, never uploaded): the source extract, the index built from it, the previous index, and a small metadata file.
 *
 * An update is transactional: the new extract is verified, the new index is built beside the old one and only renamed into place once it opens
 * and passes a sanity check. Any failure leaves the working index exactly as it was.
 */
export const osmDir = (home = agentHome()) => join(home, "data", "osm");
export function osmPaths(home = agentHome()) {
  const dir = osmDir(home);
  return {
    dir,
    pbf: join(dir, "belgium-latest.osm.pbf"),
    pbfNext: join(dir, "belgium-next.osm.pbf"),
    index: join(dir, "business-index.sqlite"),
    building: join(dir, "business-index.building.sqlite"),
    previous: join(dir, "business-index.previous.sqlite"),
    metadata: join(dir, "metadata.json"),
    geocodeCache: join(dir, "geocode-cache.json"),
  };
}

export type Metadata = {
  source: string;
  sourceUrl: string;
  attribution: string;
  schemaVersion: number;
  pbf: { md5: string | null; bytes: number; lastModified: string | null };
  /** When the OpenStreetMap data itself was current (the extract's own timestamp), as an ISO string. */
  dataDate: string | null;
  index: { builtAt: string; businesses: number; places: number; bytes: number; importSeconds: number };
  lastCheckedAt: string;
  lastUpdatedAt: string;
};

export function readMetadata(home = agentHome()): Metadata | null {
  try {
    const m = JSON.parse(readFileSync(osmPaths(home).metadata, "utf8")) as Metadata;
    return m && typeof m === "object" && m.index ? m : null;
  } catch {
    return null;
  }
}

function writeMetadata(home: string, m: Metadata): void {
  const p = osmPaths(home);
  writeFileSync(`${p.metadata}.tmp`, JSON.stringify(m, null, 2), "utf8");
  renameSync(`${p.metadata}.tmp`, p.metadata);
}

export type BusinessDataStatus = {
  /** An extract and a usable index are present. */
  indexReady: boolean;
  source: string;
  dataDate: string | null;
  ageDays: number | null;
  freshness: Freshness | "unknown";
  businesses: number;
  places: number;
  indexBytes: number;
  pbfBytes: number;
  lastCheckedAt: string | null;
  lastUpdatedAt: string | null;
  attribution: string;
};

/** What is installed, read from the metadata and the index file; never touches the network. */
export function businessDataStatus(home = agentHome(), now = Date.now()): BusinessDataStatus {
  const p = osmPaths(home);
  const m = readMetadata(home);
  let ready = false;
  if (m && existsSync(p.index)) {
    try {
      const db = openIndex(p.index);
      try {
        ready = Number(readMeta(db).schema_version) === SCHEMA_VERSION && m.schemaVersion === SCHEMA_VERSION;
      } finally {
        db.close();
      }
    } catch {
      ready = false;
    }
  }
  const dataDate = m?.dataDate ?? null;
  return {
    indexReady: ready,
    source: SOURCE_NAME,
    dataDate,
    ageDays: dataDate ? Math.max(0, Math.floor((now - Date.parse(dataDate)) / 86_400_000)) : null,
    freshness: ready ? freshness(dataDate, now) : "unknown",
    businesses: ready ? (m?.index.businesses ?? 0) : 0,
    places: ready ? (m?.index.places ?? 0) : 0,
    indexBytes: ready && existsSync(p.index) ? statSync(p.index).size : 0,
    pbfBytes: existsSync(p.pbf) ? statSync(p.pbf).size : 0,
    lastCheckedAt: m?.lastCheckedAt ?? null,
    lastUpdatedAt: m?.lastUpdatedAt ?? null,
    attribution: ATTRIBUTION,
  };
}

/** The few fields the CRM shows; no paths. Sent with each heartbeat. */
export function heartbeatSummary(home = agentHome(), now = Date.now()): HeartbeatBusinessData {
  const s = businessDataStatus(home, now);
  return s.indexReady
    ? { state: "ready", source: s.source, dataDate: s.dataDate, businesses: s.businesses, freshness: s.freshness === "unknown" ? "unknown" : s.freshness }
    : { state: "missing", source: s.source, dataDate: null, businesses: null, freshness: "unknown" };
}

export const NOT_INSTALLED_MESSAGE = "Local business data is not installed yet.";
export const SETUP_COMMAND = "npm run prospect-agent -- update-business-data";

/** "2 days ago", "today", for the status lines. */
export function ageText(ageDays: number | null): string {
  if (ageDays === null) return "date unknown";
  return ageDays <= 0 ? "updated today" : ageDays === 1 ? "updated 1 day ago" : `updated ${ageDays} days ago`;
}

/** One line for the console and the CRM: never contains a filesystem path. */
export function statusLine(s: BusinessDataStatus): string {
  if (!s.indexReady) return `${NOT_INSTALLED_MESSAGE} Run: ${SETUP_COMMAND}`;
  const warn = s.freshness === "fresh" ? "" : ` - older than ${FRESH_DAYS} days, refresh with: ${SETUP_COMMAND}`;
  return `Local Belgium index · ${ageText(s.ageDays)}${warn}`;
}

export function md5File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("md5");
    createReadStream(path).on("data", (c) => hash.update(c)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
  });
}

/** The real stages of an update, for a UI that shows progress. `percent` is of the whole update only where it is known (download, build). */
export type UpdateStage =
  | { stage: "checking" }
  | { stage: "verifying"; detail: "existing_extract" | "download" | "index" }
  | { stage: "downloading"; bytes: number; total: number | null }
  | { stage: "building"; percent: number }
  | { stage: "installing" }
  | { stage: "done"; outcome: "up_to_date" | "updated" | "failed" };

export type UpdateDeps = {
  home?: string;
  force?: boolean;
  log?: (message: string) => void;
  onStage?: (stage: UpdateStage) => void;
  now?: () => number;
  remote?: () => Promise<RemoteInfo>;
  download?: (opts: { dest: string; info: RemoteInfo; onProgress?: (bytes: number, total: number | null) => void }) => Promise<DownloadResult>;
  build?: (opts: { pbfPath: string; outPath: string; log?: (m: string) => void; extraMeta?: Record<string, string> }) => BuildStats;
  /** A built index with fewer businesses than this is rejected as broken (a truncated or wrong file). Tests lower it. */
  minBusinesses?: number;
};

export type UpdateResult =
  | { outcome: "up_to_date"; status: BusinessDataStatus }
  | { outcome: "updated"; status: BusinessDataStatus; downloadedBytes: number; downloadSeconds: number; reusedExtract: boolean; build: BuildStats }
  | { outcome: "failed"; message: string; status: BusinessDataStatus };

/**
 * Check what Geofabrik publishes; if the installed data is already that version (and not forced) do nothing; otherwise download (or reuse an
 * identical file already on disk), verify, build the index into a new file and only then swap it in.
 */
export async function updateBusinessData(deps: UpdateDeps = {}): Promise<UpdateResult> {
  const home = deps.home ?? agentHome();
  const log = deps.log ?? (() => undefined);
  const stage = (s: UpdateStage) => {
    try {
      deps.onStage?.(s);
    } catch {
      /* a UI callback must never break an update */
    }
  };
  const now = deps.now ?? Date.now;
  const p = osmPaths(home);
  mkdirSync(p.dir, { recursive: true });
  const fail = (message: string): UpdateResult => {
    stage({ stage: "done", outcome: "failed" });
    return { outcome: "failed", message, status: businessDataStatus(home, now()) };
  };
  stage({ stage: "checking" });
  const cleanup = () => {
    rmSync(p.building, { force: true });
    rmSync(`${p.building}-journal`, { force: true });
  };

  let info: RemoteInfo;
  try {
    info = await (deps.remote ?? (() => fetchRemoteInfo()))();
  } catch (e) {
    return fail(`Could not reach Geofabrik to check for new data (${e instanceof Error ? e.message : "no answer"}). The installed data was not changed.`);
  }

  const current = readMetadata(home);
  const before = businessDataStatus(home, now());
  if (!deps.force && before.indexReady && current && info.md5 && current.pbf.md5 === info.md5) {
    writeMetadata(home, { ...current, lastCheckedAt: new Date(now()).toISOString() });
    stage({ stage: "done", outcome: "up_to_date" });
    return { outcome: "up_to_date", status: businessDataStatus(home, now()) };
  }

  // Reuse an extract that is already on disk and identical to the published one (for example from an earlier interrupted update).
  let pbfPath = p.pbfNext;
  let reused = false;
  let downloadedBytes = 0;
  let downloadSeconds = 0;
  let md5: string | null = info.md5;
  try {
    if (info.md5 && existsSync(p.pbf)) stage({ stage: "verifying", detail: "existing_extract" });
    if (info.md5 && existsSync(p.pbf) && (await md5File(p.pbf)) === info.md5) {
      pbfPath = p.pbf;
      reused = true;
      log("The extract on disk is already the published version; no download needed.");
    } else {
      rmSync(p.pbfNext, { force: true });
      const t0 = now();
      stage({ stage: "downloading", bytes: 0, total: info.sizeBytes });
      const dl = await (deps.download ?? ((o) => downloadPbf(o)))({
        dest: p.pbfNext,
        info,
        onProgress: (b, total) => {
          log(`downloading: ${(b / 1e6).toFixed(0)} MB${total ? ` of ${(total / 1e6).toFixed(0)} MB` : ""}`);
          stage({ stage: "downloading", bytes: b, total });
        },
      });
      stage({ stage: "verifying", detail: "download" });
      downloadedBytes = dl.bytes;
      downloadSeconds = Math.round((now() - t0) / 1000);
      md5 = dl.md5;
      if (!dl.verified) log("Geofabrik did not publish a checksum, so only the file size was verified.");
    }
  } catch (e) {
    rmSync(p.pbfNext, { force: true });
    return fail(`The download failed (${e instanceof Error ? e.message : "error"}). The installed data was not changed.`);
  }

  cleanup();
  let stats: BuildStats;
  try {
    stage({ stage: "building", percent: 0 });
    // The index builder reports "pass 1/2: 40%"; both passes together make up the percentage shown.
    const buildLog = (m: string) => {
      log(m);
      const hit = /^pass (\d)\/2: (\d+)%/.exec(m);
      if (hit) stage({ stage: "building", percent: Math.min(100, (Number(hit[1]) - 1) * 50 + Number(hit[2]) / 2) });
    };
    stats = (deps.build ?? buildIndex)({ pbfPath, outPath: p.building, log: buildLog, extraMeta: { source: SOURCE_NAME } });
    const min = deps.minBusinesses ?? 1000;
    if (stats.businesses < min) throw new Error(`the new index has only ${stats.businesses} businesses (expected at least ${min})`);
    stage({ stage: "verifying", detail: "index" });
    const db = openIndex(p.building);
    try {
      const check = db.prepare("pragma quick_check").get() as { quick_check?: string } | undefined;
      if (check?.quick_check !== "ok") throw new Error("the new index failed its integrity check");
    } finally {
      db.close();
    }
  } catch (e) {
    cleanup();
    if (!reused) rmSync(p.pbfNext, { force: true });
    return fail(`Building the new index failed (${e instanceof Error ? e.message : "error"}). The previous index is still in use.`);
  }

  // Swap. The old index is kept as "previous" and restored if the second rename fails.
  stage({ stage: "installing" });
  try {
    rmSync(p.previous, { force: true });
    if (existsSync(p.index)) renameSync(p.index, p.previous);
    try {
      renameSync(p.building, p.index);
    } catch (e) {
      if (existsSync(p.previous)) renameSync(p.previous, p.index);
      throw e;
    }
    if (!reused) {
      rmSync(p.pbf, { force: true });
      renameSync(p.pbfNext, p.pbf);
    }
  } catch (e) {
    cleanup();
    return fail(`The new index could not be put in place (${e instanceof Error ? e.message : "error"}). The previous index is still in use.`);
  }

  const dataDate = stats.dataDate ?? (info.lastModified ? new Date(info.lastModified).toISOString() : null);
  const stamp = new Date(now()).toISOString();
  writeMetadata(home, {
    source: SOURCE_NAME,
    sourceUrl: GEOFABRIK_URL,
    attribution: ATTRIBUTION,
    schemaVersion: SCHEMA_VERSION,
    pbf: { md5, bytes: statSync(p.pbf).size, lastModified: info.lastModified },
    dataDate,
    index: { builtAt: stamp, businesses: stats.businesses, places: stats.places, bytes: stats.indexBytes, importSeconds: stats.seconds },
    lastCheckedAt: stamp,
    lastUpdatedAt: stamp,
  });
  stage({ stage: "done", outcome: "updated" });
  return { outcome: "updated", status: businessDataStatus(home, now()), downloadedBytes, downloadSeconds, reusedExtract: reused, build: stats };
}
