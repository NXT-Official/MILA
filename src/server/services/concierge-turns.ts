import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { conversationTitle } from "@/lib/concierge-title";
import { captureServerException } from "@/lib/sentry.server";

type MilaSupabaseClient = SupabaseClient<Database>;

export type SaveConciergeTurnArgs = {
  userId: string;
  /** The conversation to append to, or null to open a new one. */
  conversationId: string | null;
  message: string;
  imageUrl: string | null;
  reply: string;
};

export type SavedConciergeTurn = { conversationId: string | null; saved: boolean };

/**
 * Writes one paid Concierge turn (her message and Mila's reply) into its
 * conversation, with the service role: it runs after the AI call, when the
 * member's request may already be gone. It never throws. A failed write answers
 * `saved: false` (with the id of a conversation it did manage to create), so a
 * paid reply is never lost to a storage hiccup; the client saves it as before.
 */
export async function saveConciergeTurn(
  args: SaveConciergeTurnArgs,
  db?: MilaSupabaseClient,
  report: (error: unknown) => void = captureServerException,
): Promise<SavedConciergeTurn> {
  let conversationId = args.conversationId;
  const created = conversationId === null;
  try {
    const client = db ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;

    if (conversationId !== null) {
      // Defence in depth: the service role bypasses RLS, so ownership is
      // re-checked here, and a failed read fails closed (nothing is written).
      const { data: owned, error: ownerError } = await client
        .from("concierge_conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("user_id", args.userId)
        .maybeSingle();
      if (ownerError) throw ownerError;
      if (!owned) {
        console.error("[concierge] refused to save a turn into a conversation that is not hers");
        // User id only: never her message or the reply.
        report(new Error(`concierge turn refused: conversation not owned by user ${args.userId}`));
        return { conversationId, saved: false };
      }
    } else {
      const { data, error } = await client
        .from("concierge_conversations")
        .insert({ user_id: args.userId, title: conversationTitle(args.message) })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("conversation insert returned no row");
      conversationId = data.id;
    }

    // Both rows share one insert; created_at is set explicitly so the reply
    // always sorts after her message (the table orders by created_at).
    const at = Date.now();
    const { error: messagesError } = await client.from("concierge_messages").insert([
      {
        conversation_id: conversationId,
        user_id: args.userId,
        role: "user",
        content: args.message,
        image_url: args.imageUrl,
        created_at: new Date(at).toISOString(),
      },
      {
        conversation_id: conversationId,
        user_id: args.userId,
        role: "assistant",
        content: args.reply,
        created_at: new Date(at + 1).toISOString(),
      },
    ]);
    if (messagesError) throw messagesError;

    if (!created) {
      // The turns are saved; a failed bump only leaves the list order stale.
      const { error: bumpError } = await client
        .from("concierge_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId)
        .eq("user_id", args.userId);
      if (bumpError) {
        console.error("[concierge] could not bump the conversation", bumpError.message);
        captureServerException(bumpError);
      }
    }
    return { conversationId, saved: true };
  } catch (err) {
    console.error("[concierge] a paid turn could not be saved", err);
    captureServerException(err);
    return { conversationId, saved: false };
  }
}
