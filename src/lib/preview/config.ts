import { isValidBaseDomain } from "./hostname";
import { MIN_SECRET_LENGTH } from "./session";

type Env = Record<string, string | undefined>;

export type PreviewConfig = {
  baseDomain: string;
  /** Null when not configured: the gateway then fails closed (shows "unavailable"). */
  sessionSecret: string | null;
  ipSalt: string | null;
  /** Resolves a preview's `upstream_secret_ref` to its secret (PREVIEW_UPSTREAM_SECRET_<REF>), or null. */
  upstreamSecret: (ref: string) => string | null;
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

  return {
    baseDomain: configured && isValidBaseDomain(configured) ? configured : "ianverlinden.com",
    sessionSecret: secret && secret.length >= MIN_SECRET_LENGTH ? secret : null,
    ipSalt: salt && salt.length >= 16 ? salt : null,
    upstreamSecret: (ref) => {
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(ref)) return null;
      const value = env[`PREVIEW_UPSTREAM_SECRET_${ref.toUpperCase()}`];
      return value && value.length >= 24 ? value : null;
    },
    gatewayOnly: env.PREVIEW_GATEWAY_ONLY === "1",
    production,
    allowLocalhost: !production,
  };
}
