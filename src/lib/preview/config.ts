import { isValidBaseDomain } from "./hostname";
import { MIN_SECRET_LENGTH } from "./session";

type Env = Record<string, string | undefined>;

export type PreviewConfig = {
  baseDomain: string;
  /** Null when not configured: the gateway then fails closed (shows "unavailable"). */
  sessionSecret: string | null;
  ipSalt: string | null;
  stateCacheSeconds: number;
  /** A dedicated gateway deployment serves ONLY preview hosts. */
  gatewayOnly: boolean;
  production: boolean;
  /** Development only. */
  allowLocalhost: boolean;
};

/** All server-only. Names are documented in .env.example; none is NEXT_PUBLIC_. */
export function getPreviewConfig(env: Env = process.env): PreviewConfig {
  const configured = env.PREVIEW_BASE_DOMAIN?.trim().toLowerCase();
  const production = env.NODE_ENV === "production";
  const secret = env.PREVIEW_SESSION_SECRET;
  const salt = env.PREVIEW_IP_HASH_SALT;
  const cacheSeconds = Number(env.PREVIEW_STATE_CACHE_SECONDS ?? "5");

  return {
    baseDomain: configured && isValidBaseDomain(configured) ? configured : "ianverlinden.com",
    sessionSecret: secret && secret.length >= MIN_SECRET_LENGTH ? secret : null,
    ipSalt: salt && salt.length >= 16 ? salt : null,
    stateCacheSeconds: Number.isFinite(cacheSeconds) ? Math.min(30, Math.max(0, cacheSeconds)) : 5,
    gatewayOnly: env.PREVIEW_GATEWAY_ONLY === "1",
    production,
    allowLocalhost: !production,
  };
}
