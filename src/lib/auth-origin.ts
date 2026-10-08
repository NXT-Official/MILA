/**
 * The origin every server-built auth link uses (sign-up confirmation, password
 * reset). It is never taken from a request header as-is: `Host`,
 * `X-Forwarded-Host` and `Origin` are client-controlled, and an auth email
 * must only ever link to a Mila deployment. Supabase's Redirect URLs
 * allow-list is a second check, not the only one.
 *
 * So the request's origin is only a hint: it is kept when it is a known Mila
 * deployment, and replaced by the deployment's own canonical URL otherwise.
 */

/**
 * The Mila web deployments: the live site (`main`) and the `nicoleDev`
 * preview. Both are on the Supabase Redirect URLs allow-list.
 * // src: Vercel projects `mila-umber` (production branch main) and
 * //      `mila-nicoledev` (production branch nicoleDev); owner, 2026-10-07
 */
export const MILA_DEPLOYMENT_ORIGINS = [
  "https://mila-umber.vercel.app",
  "https://mila-nicoledev.vercel.app",
] as const;

export interface AuthOriginConfig {
  allowed: readonly string[];
  canonical: string;
  /** Local dev only: any localhost / 127.0.0.1 origin. */
  devLocalhost: boolean;
}

/** `scheme://host[:port]` of an http(s) URL, or null. */
function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.origin;
}

/** Vercel's URL variables are bare domains (no scheme). */
function vercelOrigin(domain: string | undefined): string | null {
  return domain ? normalizeOrigin(`https://${domain}`) : null;
}

/**
 * The allowlist and fallback for this deployment. Vercel sets
 * `VERCEL_PROJECT_PRODUCTION_URL` (this project's production domain, also on
 * previews), `VERCEL_BRANCH_URL` and `VERCEL_URL` at build and run time, as
 * bare domains. They come from the platform, not the request.
 * // src: https://vercel.com/docs/environment-variables/system-environment-variables
 */
export function authOriginConfig(env: Record<string, string | undefined>): AuthOriginConfig {
  const own = [env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_BRANCH_URL, env.VERCEL_URL]
    .map(vercelOrigin)
    .filter((origin): origin is string => origin !== null);
  const allowed = [...new Set<string>([...MILA_DEPLOYMENT_ORIGINS, ...own])];
  return {
    allowed,
    canonical: vercelOrigin(env.VERCEL_PROJECT_PRODUCTION_URL) ?? MILA_DEPLOYMENT_ORIGINS[0],
    devLocalhost: env.NODE_ENV === "development",
  };
}

function isLocalhost(origin: string): boolean {
  const { hostname } = new URL(origin);
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/** The first candidate that is a known deployment, else the canonical URL. Never a forged value. */
export function pickAuthOrigin(candidates: readonly unknown[], config: AuthOriginConfig): string {
  for (const candidate of candidates) {
    const origin = normalizeOrigin(candidate);
    if (!origin) continue;
    if (config.allowed.includes(origin)) return origin;
    if (config.devLocalhost && isLocalhost(origin)) return origin;
  }
  return config.canonical;
}
