import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { verifyHcaptcha } from "./hcaptcha.server";
import { consumeRateLimit, RateLimitExceededError } from "./ai-rate-limit.server";

const SubmitSupportMessageInput = z.object({
  kind: z.enum(["help", "feedback"]),
  message: z.string().trim().min(1).max(2000),
  captchaToken: z.string().min(1).max(4000),
});

const SUPPORT_SUBMIT_LIMIT = 5;
const SUPPORT_SUBMIT_WINDOW_SECONDS = 10 * 60;

function clientIp(): string {
  const forwarded = getRequest()?.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export const submitSupportMessage = createServerFn({ method: "POST" })
  .validator((input: unknown) => SubmitSupportMessageInput.parse(input))
  .handler(async ({ data }) => {
    const ip = clientIp();

    try {
      await consumeRateLimit(
        `support-message:${ip}`,
        SUPPORT_SUBMIT_LIMIT,
        SUPPORT_SUBMIT_WINDOW_SECONDS,
      );
    } catch (err) {
      if (err instanceof RateLimitExceededError) throw new Error(err.message);
      throw err;
    }

    await verifyHcaptcha(data.captchaToken, ip !== "unknown" ? ip : undefined);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("support_messages")
      .insert({ kind: data.kind, message: data.message });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
