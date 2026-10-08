import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BodyScanInput, runBodyScanForUser } from "@/server/services/body-scan";
import {
  CheckInInput,
  getCheckInStatusForUser,
  runCheckInForUser,
} from "@/server/services/check-in";

export type { BodyScanResult, BodyScanStatus } from "@/server/services/body-scan";
export type { CheckInRead, CheckInResult, CheckInStatus } from "@/server/services/check-in";

/**
 * The web client's entry points for Today's check-in and the body scan. The
 * logic, prices and limits live in `src/server/services/check-in.ts` and
 * `src/server/services/body-scan.ts`, shared verbatim with
 * `POST /api/v1/check-in`, `GET /api/v1/check-in/status` and
 * `POST /api/v1/analysis/body-scan` for mobile. Failures ride the answer as
 * `{ success: false, error }`; only "another read is still running"
 * (GenerationInFlightError) is thrown.
 */

export const runCheckIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => CheckInInput.parse(input))
  .handler(async ({ data, context }) => runCheckInForUser(context.supabase, context.userId, data));

export const getCheckInStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => getCheckInStatusForUser(context.supabase, context.userId));

export const runBodyScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => BodyScanInput.parse(input))
  .handler(async ({ data, context }) => runBodyScanForUser(context.supabase, context.userId, data));
