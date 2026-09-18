import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { respondWithError } from "@/server/http/respond";
import { MemberProfileInput } from "@/lib/posts.functions";
import { getMemberProfileForUser } from "@/server/services/posts";

export type HandleProfileMemberDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  getMemberProfileForUser: typeof getMemberProfileForUser;
};

const defaultDeps: HandleProfileMemberDeps = { verifyBearerAuth, getMemberProfileForUser };

/**
 * `GET /api/v1/profile/member?user_id=<uuid>` — mirrors `getMemberProfile` in
 * `src/lib/posts.functions.ts`. Free, no rate limit. See
 * `MILA_MOBILE/src/services/api/posts.ts`.
 */
export async function handleProfileMember(
  request: Request,
  deps: HandleProfileMemberDeps = defaultDeps,
): Promise<Response> {
  try {
    const { supabase, userId } = await deps.verifyBearerAuth(request);
    const url = new URL(request.url);
    const input = MemberProfileInput.parse({ user_id: url.searchParams.get("user_id") });

    const profile = await deps.getMemberProfileForUser(supabase, userId, input);
    return Response.json(profile);
  } catch (error) {
    return respondWithError("profile/member", error);
  }
}

export const Route = createFileRoute("/api/v1/profile/member")({
  server: {
    handlers: {
      GET: async ({ request }) => handleProfileMember(request),
    },
  },
});
