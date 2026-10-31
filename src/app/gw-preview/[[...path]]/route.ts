import { getPreviewConfig } from "@/lib/preview/config";
import { handleGatewayRequest } from "@/lib/preview/gateway";
import { fetchUpstream } from "@/lib/preview/safe-fetch";
import { createRpcStore, withStateCache, type PreviewStore } from "@/lib/preview/store";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * Preview gateway. `src/proxy.ts` rewrites every request for a preview hostname
 * (<name>.ianverlinden.com) to this internal path; requests for any other host get a 404 here.
 * The handler never trusts the path: it re-validates the Host header itself.
 */
let store: PreviewStore | undefined;
function getStore(seconds: number): PreviewStore {
  store ??= withStateCache(
    createRpcStore((fn, args) => createPublicClient().rpc(fn as never, args as never) as never),
    seconds,
  );
  return store;
}

async function handle(request: Request): Promise<Response> {
  const config = getPreviewConfig();
  return handleGatewayRequest(request, {
    config,
    store: getStore(config.stateCacheSeconds),
    fetchUpstream,
    // Structured, secret-free events only.
    log: (event) => console.info(JSON.stringify({ preview: event })),
  });
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
