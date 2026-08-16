import { z } from "zod";
import { ApiError } from "@/server/api/respond";
import { getRequestIP } from "@tanstack/react-start/server";
import { verifyHcaptcha } from "@/lib/hcaptcha.server";
import { RateLimitExceededError, consumeRateLimit } from "@/lib/rate-limit.server";

export const SubmitSupportMessageInput = z.object({
  kind: z.enum(["help", "feedback"]),
  message: z.string().trim().min(1).max(2000),
  captchaToken: z.string().min(1).max(4000),
});

/**
 * Help and feedback — the one surface with **no session behind it**, on the
 * website's login screen and in the phone's settings alike.
 *
 * That is the whole reason for the captcha and the IP limit: with no member to
 * attribute a message to, they are the only thing between this and an open
 * relay into the studio's inbox. Both run before the insert, and the insert
 * needs the service role because `support_messages` grants no INSERT to
 * `authenticated`.
 *
 * ponytail: the rate-limit bucket is keyed on the socket peer address, matching
 * what the website already does. Behind a CDN that collapses every caller into
 * one bucket of 3/15min — key it on a trusted forwarded header once the
 * deployment topology is known.
 */
export async function submitSupportMessageService(
  input: z.infer<typeof SubmitSupportMessageInput>,
) {
  const ip = getRequestIP();

  await consumeRateLimit(`support-message:${ip ?? "unknown"}`, { limit: 3, windowSeconds: 900 });

  await verifyHcaptcha(input.captchaToken, ip);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("support_messages")
    .insert({ kind: input.kind, message: input.message });
  if (error) throw new Error(error.message);
  return { ok: true as const };
}

/**
 * The service throws plain `Error`s because the website catches them as text.
 * `/api/v1` needs codes, and the phone switches on them — a spent captcha has
 * to reach the member as something she can retry, not as a dead end.
 */
export function toSupportApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (error instanceof RateLimitExceededError) {
    return new ApiError(
      "RATE_LIMITED",
      "Too many messages just now. Please try again shortly.",
      429,
      error.retryAfterSeconds,
    );
  }

  const message = error instanceof Error ? error.message : "";

  if (/captcha verification failed/i.test(message)) {
    return new ApiError("VALIDATION_FAILED", message, 400);
  }
  // A missing hCaptcha secret or an unreachable rate-limit store. Neither is
  // the member's fault and neither is permanent.
  if (/not available|temporarily unavailable/i.test(message)) {
    return new ApiError("UPSTREAM_UNAVAILABLE", message, 503);
  }

  console.error("[api/v1/support] service failure", error);
  return new ApiError("INTERNAL", "Your message couldn't be sent. Please try again.", 500);
}
