import type { BusinessSource } from "../../../src/lib/prospecting/providers/types";
import type { DiscoveryRequest, RawBusiness } from "../../../src/lib/prospecting/types";
import { OsmBusinessSource, OVERPASS_ENDPOINTS, SourceError } from "./osm-source";
import { businessDataStatus, type BusinessDataStatus } from "./osm/data-manager";
import { BusinessDataMissingError, LocalOsmBusinessSource, type LocalSourceOptions } from "./osm/local-osm-source";

/**
 * Which discovery source answers a search. The local OpenStreetMap index is preferred: it answers in well under a second and does not depend on
 * a public server. The public Overpass service is only a FALLBACK, never the default, and only when explicitly allowed
 * (config.json "overpassFallback": true, or PROSPECT_AGENT_OVERPASS_FALLBACK=1):
 *
 *   index healthy                    -> local index (Overpass is not contacted)
 *   index missing                    -> Overpass if the fallback is allowed, otherwise a clear error naming the setup command
 *   index older than the hard limit  -> Overpass (short budget) if allowed, and if that fails the old local data is still used
 *
 * The fallback gets a short time budget, so a busy public server costs seconds, not minutes.
 */
export const FALLBACK_BUDGET_MS = 45_000;

export type CompositeOptions = {
  home?: string;
  allowOverpass?: boolean;
  local?: LocalSourceOptions;
  /** Tests. */
  localSource?: BusinessSource & { last?: unknown };
  overpassSource?: BusinessSource;
  status?: () => BusinessDataStatus;
  log?: (message: string, fields?: Record<string, unknown>) => void;
};

export class CompositeBusinessSource implements BusinessSource {
  readonly id = "local_osm";
  /** Which source answered the most recent search. */
  used: "local_osm" | "overpass" | null = null;
  readonly local: LocalOsmBusinessSource | (BusinessSource & { last?: unknown });

  constructor(private readonly opts: CompositeOptions = {}) {
    this.local = opts.localSource ?? new LocalOsmBusinessSource({ home: opts.home, ...opts.local });
  }

  private overpass(): BusinessSource {
    return this.opts.overpassSource ?? new OsmBusinessSource(fetch, undefined, OVERPASS_ENDPOINTS.slice(0, 2), 20_000, FALLBACK_BUDGET_MS);
  }

  async discover(request: DiscoveryRequest): Promise<RawBusiness[]> {
    const log = this.opts.log ?? (() => undefined);
    const status = (this.opts.status ?? (() => businessDataStatus(this.opts.home)))();
    const allow = Boolean(this.opts.allowOverpass);

    if (!status.indexReady) {
      if (!allow) throw new BusinessDataMissingError();
      log("local business data is not installed; using the public Overpass service as a fallback");
      this.used = "overpass";
      return this.overpass().discover(request);
    }

    if (status.freshness === "stale" && allow) {
      try {
        log("local business data is very old; trying the public Overpass service first");
        const live = await this.overpass().discover(request);
        this.used = "overpass";
        return live;
      } catch (e) {
        log("the public Overpass service did not answer; using the older local data", { error: e instanceof SourceError ? e.message : "error" });
      }
    }
    if (status.freshness !== "fresh") log("local business data is older than 7 days; refresh with: npm run prospect-agent -- update-business-data", { dataDate: status.dataDate });
    this.used = "local_osm";
    return this.local.discover(request);
  }
}
