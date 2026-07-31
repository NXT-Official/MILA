import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";
import { verifyHcaptcha } from "./hcaptcha.server";
import { consumeRateLimit } from "./rate-limit.server";

const SubmitSupportMessageInput = z.object({
  kind: z.enum(["help", "feedback"]),
  message: z.string().trim().min(1).max(2000),
  captchaToken: z.string().min(1).max(4000),
});

export const submitSupportMessage = createServerFn({ method: "POST" })
  .validator((input: unknown) => SubmitSupportMessageInput.parse(input))
  .handler(async ({ data }) => {
    const ip = getRequestIP();

    await consumeRateLimit(`support-message:${ip ?? "unknown"}`, { limit: 3, windowSeconds: 900 });

    await verifyHcaptcha(data.captchaToken, ip);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("support_messages")
      .insert({ kind: data.kind, message: data.message });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
