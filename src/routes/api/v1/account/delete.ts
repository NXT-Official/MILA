import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { parseJsonBody, respondWithError } from "@/server/http/respond";
import { deleteAccountForApiUser } from "@/server/services/account";

const DeleteAccountInput = z.object({ email: z.string().min(1).max(320) });

export type HandleAccountDeleteDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  deleteAccountForApiUser: typeof deleteAccountForApiUser;
};

const defaultDeps: HandleAccountDeleteDeps = { verifyBearerAuth, deleteAccountForApiUser };

/**
 * `POST /api/v1/account/delete` — irreversible. Cancels billing, purges
 * storage, deletes the auth user. Mirrors `deleteMyAccount` in
 * `src/lib/account.functions.ts`. See
 * `MILA_MOBILE/src/services/api/account.ts`.
 */
export async function handleAccountDelete(
  request: Request,
  deps: HandleAccountDeleteDeps = defaultDeps,
): Promise<Response> {
  try {
    const { supabase, userId } = await deps.verifyBearerAuth(request);
    const body = await parseJsonBody(request);
    const input = DeleteAccountInput.parse(body);

    const result = await deps.deleteAccountForApiUser(supabase, userId, input.email);
    return Response.json(result);
  } catch (error) {
    return respondWithError("account/delete", error);
  }
}

export const Route = createFileRoute("/api/v1/account/delete")({
  server: {
    handlers: {
      POST: async ({ request }) => handleAccountDelete(request),
    },
  },
});
