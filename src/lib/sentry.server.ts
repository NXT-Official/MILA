import * as Sentry from "@sentry/node";
import { AiUnavailableError, DomainValidationError } from "@/server/http/api-errors";

// Optional: local dev and any deployment without a configured Sentry project
// must keep working with this unset, so this is a plain guard rather than
// requireEnv (see src/lib/env.ts) — a missing DSN must not hard-fail the app.
const dsn = process.env.SENTRY_DSN;

// Reporting is for the deployed app, not for a developer's machine or a test
// run. The vitest suite loads the same .env.local, so SENTRY_DSN is set there
// too and every failure the tests deliberately provoke (weak password,
// captcha rejected, invalid refresh token, unreachable mailer, missing
// relation) was landing in Sentry as an unresolved issue with
// environment=test. Gate on NODE_ENV so only production reports.
const enabled = Boolean(dsn) && process.env.NODE_ENV === "production";

if (enabled) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}

/**
 * Errors that are part of normal operation rather than defects.
 *
 * AiUnavailableError means the AI provider was briefly unavailable or
 * returned a payload that failed validation: the credit is refunded
 * (withAiCredit) and the caller gets a designed 503 AI_UNAVAILABLE with a
 * retry message (src/server/http/respond.ts). DomainValidationError means the
 * member's data isn't complete enough to act on, and also has a designed
 * response. Neither is a bug, so neither should open a Sentry issue — that
 * only produces issues that get resolved by hand and then "regress" the next
 * time the provider hiccups.
 */
const EXPECTED_CONDITIONS = [AiUnavailableError, DomainValidationError];

/** Reports a server-side error to Sentry. No-op outside production, or when
 * SENTRY_DSN is unset, or for the expected conditions above. */
export function captureServerException(error: unknown): void {
  if (!enabled) return;
  if (EXPECTED_CONDITIONS.some((condition) => error instanceof condition)) {
    console.warn("[sentry] expected condition, not reported:", (error as Error)?.message ?? error);
    return;
  }
  Sentry.captureException(error);
}
