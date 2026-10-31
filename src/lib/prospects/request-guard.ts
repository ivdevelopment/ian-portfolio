/**
 * Browser-initiated POSTs to the admin's data endpoints must come from the admin itself. Cookies are SameSite=Lax
 * (cross-site POSTs don't carry them), and this additionally rejects a request whose Origin is another site.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  try {
    return new URL(origin).host === new URL(request.url).host || origin === `https://${request.headers.get("host")}` || origin === `http://${request.headers.get("host")}`;
  } catch {
    return false;
  }
}
