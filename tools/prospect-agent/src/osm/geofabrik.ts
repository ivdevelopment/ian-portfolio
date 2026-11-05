import { createHash } from "node:crypto";
import { createWriteStream, existsSync, renameSync, rmSync, statSync } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * The Belgian OpenStreetMap extract, published by Geofabrik. It is downloaded rarely (never per search) and verified with the MD5 that Geofabrik
 * publishes next to it. Data © OpenStreetMap contributors, available under the Open Database License (ODbL); extract provided by Geofabrik GmbH.
 */
export const GEOFABRIK_URL = "https://download.geofabrik.de/europe/belgium-latest.osm.pbf";
export const SOURCE_NAME = "Geofabrik Belgium";
export const ATTRIBUTION = "© OpenStreetMap contributors (ODbL), extract by Geofabrik";
const UA = "IanProspectAgent/1.0 (+https://ianverlinden.com)";

type Fetch = typeof fetch;
export type RemoteInfo = { url: string; sizeBytes: number | null; lastModified: string | null; etag: string | null; md5: string | null };

/** What is currently published: size, last-modified, and the MD5 of the file. No data is downloaded. */
export async function fetchRemoteInfo(fetchImpl: Fetch = fetch, url = GEOFABRIK_URL): Promise<RemoteInfo> {
  const head = await fetchImpl(url, { method: "HEAD", headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!head.ok) throw new Error(`Geofabrik answered ${head.status}`);
  let md5: string | null = null;
  try {
    const res = await fetchImpl(`${url}.md5`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
    if (res.ok) md5 = /^[0-9a-f]{32}/i.exec((await res.text()).trim())?.[0].toLowerCase() ?? null;
  } catch {
    /* integrity then relies on the size check alone, and the update says so */
  }
  const size = Number(head.headers.get("content-length"));
  return { url: head.url || url, sizeBytes: Number.isFinite(size) && size > 0 ? size : null, lastModified: head.headers.get("last-modified"), etag: head.headers.get("etag"), md5 };
}

export type DownloadResult = { bytes: number; md5: string; verified: boolean };

/**
 * Streams the file to `dest.part`, hashing as it goes, and only renames it to `dest` when the size and MD5 match what Geofabrik published.
 * A failed or truncated download is deleted and never replaces anything.
 */
export async function downloadPbf(opts: { dest: string; info: RemoteInfo; fetchImpl?: Fetch; onProgress?: (bytes: number, total: number | null) => void }): Promise<DownloadResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const part = `${opts.dest}.part`;
  rmSync(part, { force: true });
  const res = await fetchImpl(opts.info.url, { headers: { "user-agent": UA }, redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Geofabrik answered ${res.status}`);
  const hash = createHash("md5");
  let bytes = 0;
  let lastReport = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      hash.update(chunk);
      if (opts.onProgress && Date.now() - lastReport > 2000) {
        lastReport = Date.now();
        opts.onProgress(bytes, opts.info.sizeBytes);
      }
      cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(part));
  } catch (error) {
    rmSync(part, { force: true });
    throw error;
  }
  const md5 = hash.digest("hex");
  if (opts.info.sizeBytes !== null && bytes !== opts.info.sizeBytes) {
    rmSync(part, { force: true });
    throw new Error(`The download is incomplete (${bytes} of ${opts.info.sizeBytes} bytes).`);
  }
  if (opts.info.md5 && md5 !== opts.info.md5) {
    rmSync(part, { force: true });
    throw new Error("The download failed its integrity check (MD5 does not match Geofabrik's).");
  }
  if (!existsSync(part) || statSync(part).size !== bytes) throw new Error("The downloaded file could not be written.");
  renameSync(part, opts.dest);
  return { bytes, md5, verified: opts.info.md5 !== null };
}

/** Fresh for a week; older data is flagged, much older data is treated as stale for the fallback decision. */
export const FRESH_DAYS = 7;
export const HARD_STALE_DAYS = 60;
export type Freshness = "fresh" | "aging" | "stale";

export function freshness(dataDate: string | null, now = Date.now()): Freshness | "unknown" {
  if (!dataDate) return "unknown";
  const ageDays = (now - Date.parse(dataDate)) / 86_400_000;
  if (!Number.isFinite(ageDays)) return "unknown";
  return ageDays <= FRESH_DAYS ? "fresh" : ageDays <= HARD_STALE_DAYS ? "aging" : "stale";
}
