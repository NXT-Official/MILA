import type { Session } from "@supabase/supabase-js";

/**
 * What a new member is told once sign-up succeeds. Kept out of
 * `signup-form.tsx` so that file exports only its component. Supabase returns a
 * session when the project auto-confirms emails, and the member is already in;
 * only when confirmation is required do they have an inbox to check.
 */
export function signupSuccessMessage(session: Session | null): string {
  return session
    ? "Welcome to Mila. Let's build your style profile."
    : "Studio profile created. Check your inbox to confirm.";
}

/**
 * The account exists but this browser could not be signed in to it. Never the
 * "couldn't create" wording: the member would try again and meet an account
 * that already exists.
 */
export const SIGNUP_SIGN_IN_FAILED_COPY =
  "Your account is ready, but we couldn't sign you in. Please log in to continue.";
