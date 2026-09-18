import { verifyHcaptcha } from "@/lib/hcaptcha.server";
import { consumeRateLimit } from "@/lib/rate-limit.server";
import { DomainValidationError } from "@/server/http/api-errors";
import type { SubmitSupportMessageInputData } from "@/lib/support.functions";

/**
 * The one **unauthenticated** route in the app. hCaptcha plus a 3-per-15-min
 * IP rate limit are the whole defence, since there is no session to gate on.
 * Shared verbatim by the web `submitSupportMessage` server function and the
 * mobile `POST /api/v1/support/message` route.
 */
export async function submitSupportMessageForIp(
  clientIp: string | null,
  data: SubmitSupportMessageInputData,
): Promise<{ ok: true }> {
  await consumeRateLimit(`support-message:${clientIp ?? "unknown"}`, {
    limit: 3,
    windowSeconds: 900,
  });

  try {
    await verifyHcaptcha(data.captchaToken, clientIp ?? undefined);
  } catch (error) {
    // hcaptcha.server.ts doesn't distinguish "the captcha itself was
    // rejected" from "the verifier is unreachable/misconfigured" — both throw
    // the same generic Error. VALIDATION_FAILED is the closer fit for the
    // mobile taxonomy: it puts the retry in the caller's hands (solve the
    // challenge again) rather than implying a server-side outage.
    throw new DomainValidationError(
      error instanceof Error ? error.message : "Captcha verification failed. Please try again.",
    );
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("support_messages")
    .insert({ kind: data.kind, message: data.message });
  if (error) throw new Error(error.message);
  return { ok: true };
}
