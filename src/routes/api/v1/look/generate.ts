import { createFileRoute } from "@tanstack/react-router";
import { requireActiveMember } from "@/server/api/auth";
import { ApiError, handler, jsonBody, ok } from "@/server/api/respond";
import { GenerateLookInput } from "@/lib/daily-look";
import { generateLook } from "@/server/services/generate-look";

/**
 * `POST /api/v1/look/generate` — the mobile client's door into the same
 * `generateLook` service the website's server function calls. This file holds
 * no styling logic, no prompt, and no credit arithmetic; if it did, the two
 * clients could drift.
 *
 * Charging happens inside the service via `withAiCredit`, so an
 * `INSUFFICIENT_CREDITS` answer here is the server's verdict — the only
 * authority on the balance. Mobile turns that code into the paywall sheet.
 */
export const Route = createFileRoute("/api/v1/look/generate")({
  server: {
    handlers: {
      POST: handler(async (request) => {
        const { supabase, user } = await requireActiveMember(request);

        const parsed = GenerateLookInput.safeParse(await jsonBody(request));
        if (!parsed.success) {
          throw new ApiError(
            "VALIDATION_FAILED",
            "Mila couldn't prepare your style profile for this look.",
            400,
          );
        }

        try {
          return ok(await generateLook({ supabase, userId: user.id, input: parsed.data }));
        } catch (error) {
          throw toApiError(error);
        }
      }),
    },
  },
});

/**
 * The service throws plain `Error`s — it predates this layer and the website
 * catches them as text. Mapping happens here rather than by rewriting the
 * service, so the web's behaviour is untouched.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const message = error instanceof Error ? error.message : "";

  if (/credit/i.test(message)) {
    return new ApiError("INSUFFICIENT_CREDITS", "You're out of credits for today.", 402);
  }
  if (/rate.?limit|too many/i.test(message)) {
    return new ApiError("RATE_LIMITED", "Mila needs a moment. Try again shortly.", 429, 60);
  }
  if (/missing from profile|complete your studio/i.test(message)) {
    return new ApiError("VALIDATION_FAILED", message, 400);
  }
  // Anything else is a provider failure or a bug. The member gets usable copy;
  // the detail stays in the server log.
  console.error("[api/v1/look] service failure", error);
  return new ApiError(
    "UPSTREAM_UNAVAILABLE",
    "Mila couldn't compose a look this time. Please try again.",
    503,
  );
}
