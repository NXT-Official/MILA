import * as Sentry from "@sentry/react";

// Optional: local dev and any deployment without a configured Sentry project
// must keep working with this unset. Do not use requireEnv here.
const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

// Production only. A dev server was reporting React "Cannot read properties of
// null (reading 'useMemo'/'useContext'/'useEffect')" from a stale Vite dep
// pre-bundle (node_modules/.vite/deps) straight into the same project as real
// production errors — unactionable development noise. import.meta.env.PROD is
// false under `vite dev`, true for a real build, so this keeps `environment`
// meaningful too. The window guard keeps the SSR pass (which also imports
// __root.tsx) from initialising a browser SDK.
const enabled = Boolean(dsn) && import.meta.env.PROD && typeof window !== "undefined";

if (enabled) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
  });
}

/** Reports a client-side error to Sentry. No-op outside production, or when
 * VITE_SENTRY_DSN is unset. */
export function captureClientException(error: unknown): void {
  if (!enabled || typeof window === "undefined") return;
  Sentry.captureException(error);
}
