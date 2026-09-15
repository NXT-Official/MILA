import * as Sentry from "@sentry/react";

// Optional: local dev and any deployment without a configured Sentry project
// must keep working with this unset. Do not use requireEnv here.
const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

// Guard against re-initializing on every module re-evaluation (e.g. HMR) and
// against running on the server, where __root.tsx is also imported for SSR.
if (dsn && typeof window !== "undefined") {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
  });
}

/** Reports a client-side error to Sentry. No-op when VITE_SENTRY_DSN is unset. */
export function captureClientException(error: unknown): void {
  if (!dsn || typeof window === "undefined") return;
  Sentry.captureException(error);
}
