import "server-only";

import { headers } from "next/headers";
import { CRM_APP_HEADER } from "./host";
import { pathsFor, type AppKind, type AppPaths } from "./paths";

/**
 * Which surface is this request on? The proxy sets `x-crm-app` on requests it routes into the CRM tree. The value only decides
 * link targets and where an expired session is sent: it never grants anything (authorisation is `requireAdmin` + RLS).
 */
export async function getAppKind(): Promise<AppKind> {
  return (await headers()).get(CRM_APP_HEADER) === "1" ? "crm" : "admin";
}

export async function getPaths(): Promise<AppPaths> {
  return pathsFor(await getAppKind());
}
