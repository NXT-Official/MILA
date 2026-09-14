import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type MilaSupabaseClient = SupabaseClient<Database>;

export async function renameConciergeConversationForUser(
  db: MilaSupabaseClient,
  userId: string,
  conversationId: string,
  title: string,
): Promise<{ id: string }> {
  const { error } = await db
    .from("concierge_conversations")
    .update({ title })
    .eq("id", conversationId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { id: conversationId };
}

// Mirrors the DB check constraint on concierge_conversations.title:
// length(trim(title)) > 0 AND length(title) <= 120
const RenameConversationInput = z.object({
  conversation_id: z.string().uuid(),
  title: z.string().trim().min(1, "Title can't be empty.").max(120, "Title is too long."),
});

export const renameConciergeConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => RenameConversationInput.parse(input))
  .handler(async ({ data, context }) => {
    return renameConciergeConversationForUser(
      context.supabase,
      context.userId,
      data.conversation_id,
      data.title,
    );
  });
