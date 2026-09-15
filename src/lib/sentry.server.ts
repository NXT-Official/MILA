import * as Sentry from "@sentry/node";

// Optional: local dev and any deployment without a configured Sentry project
// must keep working with this unset, so this is a plain guard rather than
// requireEnv (see src/lib/env.ts) — a missing DSN must not hard-fail the app.
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}

/** Reports a server-side error to Sentry. No-op when SENTRY_DSN is unset. */
export function captureServerException(error: unknown): void {
  if (!dsn) return;
  Sentry.captureException(error);
}
