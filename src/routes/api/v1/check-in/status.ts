import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAuth } from "@/integrations/supabase/auth-middleware";
import { respondWithError } from "@/server/http/respond";
import { getCheckInStatusForUser } from "@/server/services/check-in";

export type HandleCheckInStatusDeps = {
  verifyBearerAuth: typeof verifyBearerAuth;
  getCheckInStatusForUser: (
    ...args: Parameters<typeof getCheckInStatusForUser>
  ) => ReturnType<typeof getCheckInStatusForUser>;
};

const defaultDeps: HandleCheckInStatusDeps = { verifyBearerAuth, getCheckInStatusForUser };

/**
 * `GET /api/v1/check-in/status` mirrors `getCheckInStatus` in
 * `src/lib/check-in.functions.ts`: `{ available, freeToday, checkInCost,
 * bodyScan: { available, free, cost } }`. `available: false` (the Wave D
 * migration is not applied, or her row could not be read) hides the entry
 * point; nothing is ever reported free on a guess. Free, no rate limit.
 */
export async function handleCheckInStatus(
  request: Request,
  deps: HandleCheckInStatusDeps = defaultDeps,
): Promise<Response> {
  try {
    const { supabase, userId } = await deps.verifyBearerAuth(request);
    return Response.json(await deps.getCheckInStatusForUser(supabase, userId));
  } catch (error) {
    return respondWithError("check-in/status", error);
  }
}

export const Route = createFileRoute("/api/v1/check-in/status")({
  server: {
    handlers: {
      GET: async ({ request }) => handleCheckInStatus(request),
    },
  },
});
