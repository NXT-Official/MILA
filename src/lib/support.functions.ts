import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const SubmitSupportMessageInput = z.object({
  kind: z.enum(["help", "feedback"]),
  message: z.string().trim().min(1).max(2000),
});

// Unauthenticated on purpose: the login page redirects signed-in users away,
// so submitters here never have a session. Writes go through the service
// role — support_messages has no anon/authenticated INSERT grant.
export const submitSupportMessage = createServerFn({ method: "POST" })
  .validator((input: unknown) => SubmitSupportMessageInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("support_messages")
      .insert({ kind: data.kind, message: data.message });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
