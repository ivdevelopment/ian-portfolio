/**
 * The agent's only way to the CRM: outbound HTTPS requests to /api/prospect-agent/<op>, authenticated with the connection token. The CRM never
 * connects to this PC: there is no server here, no port, no tunnel.
 */
export class AgentApiError extends Error {
  constructor(readonly kind: "unauthorized" | "lease_lost" | "rate_limited" | "rejected" | "server" | "network", message: string, readonly status = 0) {
    super(message);
  }
}

export type Fetch = typeof fetch;
export type RunParams = { id: string; mode: string; location: string; area: string | null; industry: string | null; threshold: number; count: number; excludeResearched: boolean; attempt: number };
export type Counters = { raw_found: number; analyzed: number; qualified: number; duplicates_removed: number; skipped_cooldown: number };

export class AgentApi {
  constructor(private readonly base: string, private readonly token: string, private readonly fetchImpl: Fetch = fetch, private readonly timeoutMs = 25_000) {}

  private async post<T>(op: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/api/prospect-agent/${op}`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
      });
    } catch {
      throw new AgentApiError("network", "The CRM could not be reached.");
    }
    let data: { ok?: boolean; error?: string } & Record<string, unknown> = {};
    try {
      data = (await res.json()) as typeof data;
    } catch {
      /* non-JSON error pages are handled by the status below */
    }
    if (res.status === 401) throw new AgentApiError("unauthorized", "The connection token was rejected (revoked or wrong).", 401);
    if (res.status === 409) throw new AgentApiError("lease_lost", "This run is no longer owned by this agent.", 409);
    if (res.status === 429) throw new AgentApiError("rate_limited", "The CRM asked the agent to slow down.", 429);
    if (res.status >= 500) throw new AgentApiError("server", `The CRM answered with an error (${res.status}).`, res.status);
    if (!res.ok || data.ok === false) throw new AgentApiError("rejected", `The CRM rejected the request (${data.error ?? res.status}).`, res.status);
    return data as T;
  }

  heartbeat(body: { codexVersion: string | null; codexState: "ready" | "not_installed" | "not_authenticated" | "error"; failureKind: string | null }) {
    return this.post<{ ok: true; device: string }>("heartbeat", body);
  }
  async claim(): Promise<RunParams | null> {
    const r = await this.post<{ ok: true; run: RunParams | null }>("claim", {});
    return r.run;
  }
  context(runId: string) {
    return this.post<{ ok: true; run: { threshold: number; mode: string; count: number }; prospects: Array<{ id: string; company_name: string; website_url: string | null; city: string | null; email_hash: string | null }>; decided: Array<{ status: string; company_name: string; website_url: string | null; city: string | null; email_hash: string | null }>; seen: Array<{ domain: string; last_analyzed_at: string }> }>("context", { runId });
  }
  progress(body: { runId: string; status?: "discovering" | "analyzing" | "qualifying"; stage: string; counters: Partial<Counters>; errors: string[] }) {
    return this.post<{ ok: true; cancel: boolean }>("progress", body);
  }
  result(body: Record<string, unknown>) {
    return this.post<{ ok: true; inserted: number; skipped_known: number; rejected: number }>("result", body);
  }
  fail(body: { runId: string; kind: string; message: string; status?: "failed" | "partial" | "cancelled" }) {
    return this.post<{ ok: true }>("fail", body);
  }
}

/** Delay before the next attempt after consecutive errors: 5 s, 10 s, 20 s ... capped at 2 minutes, with a little jitter. */
export function backoffMs(failures: number, random = Math.random): number {
  const base = Math.min(120_000, 5_000 * 2 ** Math.max(0, failures - 1));
  return Math.round(base * (0.85 + random() * 0.3));
}
