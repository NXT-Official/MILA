import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { deleteAccountForUser, supabaseDeleteAccountDeps } from "@/lib/account.functions";
import { DomainValidationError } from "@/server/http/api-errors";

type MilaSupabaseClient = SupabaseClient<Database>;

/**
 * Deletes the caller's account: cancels billing, purges storage, deletes the
 * auth user, and lets the schema cascade the rest. Irreversible.
 *
 * `deleteAccountForUser` (in `src/lib/account.functions.ts`) already is the
 * shared, dependency-injected business logic — this is the thin adapter the
 * mobile `POST /api/v1/account/delete` route needs on top of it: the web
 * server function returns `{ error }` as a value so the UI can show it
 * inline, but the `/api/v1/*` error contract is exception-based, so a
 * returned `{ error }` becomes a thrown `DomainValidationError` here.
 */
export async function deleteAccountForApiUser(
  supabase: MilaSupabaseClient,
  userId: string,
  email: string,
): Promise<{ success: true }> {
  const result = await deleteAccountForUser(supabase, userId, email, supabaseDeleteAccountDeps);
  if ("error" in result) throw new DomainValidationError(result.error);
  return result;
}
