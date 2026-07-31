import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { verifyHcaptcha } from "./hcaptcha.server";
import { clientIp, consumeRateLimit, RATE_LIMIT_POLICIES } from "./rate-limit.server";

const SubmitSupportMessageInput = z.object({
  kind: z.enum(["help", "feedback"]),
  message: z.string().trim().min(1).max(2000),
  captchaToken: z.string().min(1).max(4000),
});

export const submitSupportMessage = createServerFn({ method: "POST" })
  .validator((input: unknown) => SubmitSupportMessageInput.parse(input))
  .handler(async ({ data }) => {
    const ip = clientIp() ?? "unknown";

    await consumeRateLimit("support-message", ip, RATE_LIMIT_POLICIES.supportIp);

    await verifyHcaptcha(data.captchaToken, ip !== "unknown" ? ip : undefined);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("support_messages")
      .insert({ kind: data.kind, message: data.message });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
