export type DomainStatus =
  /** The hostname answers and identifies itself as the preview gateway. */
  | "ready"
  /** The hostname answers, but something else serves it (e.g. the client's own deployment). */
  | "elsewhere"
  /** No answer: DNS or the domain assignment isn't in place yet. */
  | "pending";

/** Marker header the gateway puts on every response it generates. */
export const GATEWAY_MARKER_HEADER = "x-preview-gateway";

/**
 * Asks the preview hostname itself (never a stored URL, so this can't be aimed elsewhere) for
 * /robots.txt, which the gateway always answers. Does not pretend DNS works when it can't tell.
 */
export async function checkDomainStatus(
  hostname: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2500,
): Promise<DomainStatus> {
  try {
    const response = await fetchImpl(`https://${hostname}/robots.txt`, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.headers.get(GATEWAY_MARKER_HEADER) === "1" ? "ready" : "elsewhere";
  } catch {
    return "pending";
  }
}
