import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { parseJsonBody, respondWithError } from "@/server/http/respond";
import { DomainValidationError } from "@/server/http/api-errors";
import { Input as ConciergeChatInputSchema } from "@/lib/concierge-chat.functions";
import { conciergeChatForUser } from "@/server/services/concierge";

export type HandleConciergeChatDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  conciergeChatForUser: typeof conciergeChatForUser;
};

const defaultDeps: HandleConciergeChatDeps = { verifyBearerAuth, conciergeChatForUser };

/**
 * `POST /api/v1/concierge/chat` — mirrors `conciergeChat` in
 * `src/lib/concierge-chat.functions.ts`. **1 AI credit**, 20 per 5 minutes.
 * See `MILA_MOBILE/src/services/api/concierge.ts`.
 */
export async function handleConciergeChat(
  request: Request,
  deps: HandleConciergeChatDeps = defaultDeps,
): Promise<Response> {
  try {
    const { supabase, userId } = await deps.verifyBearerAuth(request);
    const body = await parseJsonBody(request);
    const parsed = ConciergeChatInputSchema.safeParse(body);
    if (!parsed.success) {
      console.error("[concierge/chat] invalid input", parsed.error.flatten());
      throw new DomainValidationError("Mila couldn't read that message. Please try again.");
    }

    const reply = await deps.conciergeChatForUser(supabase, userId, parsed.data);
    return Response.json(reply);
  } catch (error) {
    return respondWithError("concierge/chat", error);
  }
}

export const Route = createFileRoute("/api/v1/concierge/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => handleConciergeChat(request),
    },
  },
});
