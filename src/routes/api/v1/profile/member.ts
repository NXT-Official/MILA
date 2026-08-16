import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireActiveMember } from "@/server/api/auth";
import { ApiError, handler, ok } from "@/server/api/respond";
import { loadMemberProfile } from "@/server/services/posts";
import { toApiError } from "../look/generate";

/**
 * `GET /api/v1/profile/member?user_id=…` — another member's public profile.
 *
 * The one endpoint here that escalates for a *read* rather than a secret: the
 * `profiles` SELECT policy is own-row only, so no member can read anyone else's
 * name through RLS. Only that lookup uses the admin client; the posts still
 * come back through the caller's own, so RLS decides what is visible.
 */
export const Route = createFileRoute("/api/v1/profile/member")({
  server: {
    handlers: {
      GET: handler(async (request) => {
        const { supabase, user } = await requireActiveMember(request);

        const target = new URL(request.url).searchParams.get("user_id");
        if (!z.string().uuid().safeParse(target).success) {
          throw new ApiError("VALIDATION_FAILED", "That member could not be found.", 400);
        }

        try {
          return ok(
            await loadMemberProfile({ supabase, userId: user.id, targetUserId: target as string }),
          );
        } catch (error) {
          throw toApiError(error);
        }
      }),
    },
  },
});
