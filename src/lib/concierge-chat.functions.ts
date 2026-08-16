import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ConciergeChatInput, conciergeReply } from "@/server/services/concierge-chat";

/**
 * The website's entry point into the concierge. Thin by design — the prompt,
 * the history budget, the rate limit, and the credit charge live in
 * `@/server/services/concierge-chat`, which `POST /api/v1/concierge/chat`
 * calls too.
 */
export type { ConciergeReply } from "@/server/services/concierge-chat";

export const conciergeChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const parsed = ConciergeChatInput.safeParse(input);
    if (!parsed.success) throw new Error("That message couldn't be sent. Please try again.");
    return parsed.data;
  })
  .handler(({ data, context }) =>
    conciergeReply({ supabase: context.supabase, userId: context.userId, input: data }),
  );
