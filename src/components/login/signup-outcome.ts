import type { Session } from "@supabase/supabase-js";

/**
 * What a new member is told once sign-up succeeds. Kept out of
 * `signup-form.tsx` so that file exports only its component. Supabase returns a
 * session when the project auto-confirms emails, and the member is already in;
 * only when confirmation is required do they have an inbox to check.
 */
export function signupSuccessMessage(session: Session | null): string {
  return session
    ? "Welcome to Mila — let's build your style profile."
    : "Studio profile created. Check your inbox to confirm.";
}
