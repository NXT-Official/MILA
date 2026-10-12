import type { Session } from "@supabase/supabase-js";
import { safeRedirect } from "@/lib/safe-redirect";
import { signupFailureMessage } from "./auth-errors";
import { SIGNUP_SIGN_IN_FAILED_COPY, signupSuccessMessage } from "./signup-outcome";

/** The three things sign-up does, injected so the order and the wording are testable. */
export interface SignupSteps {
  createAccount: () => Promise<{ session: Session | null }>;
  /** Resolves with Supabase's `{ error }`, which is how `setSession` reports a refusal. */
  startSession: (session: Session) => Promise<{ error: unknown } | void>;
  /** Analytics. Best effort: it can never change what the member is told. */
  trackSignup: (session: Session) => void | Promise<void>;
}

export interface SignupOutcome {
  /** "failed" means no account was made; "created" means it exists, whatever happened next. */
  status: "failed" | "created";
  message: string;
}

function runBestEffort(task: () => void | Promise<void>): void {
  try {
    Promise.resolve(task()).catch(() => undefined);
  } catch {
    // Analytics must never fail a sign-up that has already succeeded.
  }
}

/**
 * Creates the account, then signs the member in. Once `createAccount` has
 * returned, the account exists: a failure after that point (the session, the
 * analytics) is never reported as "we couldn't create that account".
 * Never throws.
 */
export async function completeSignup(steps: SignupSteps): Promise<SignupOutcome> {
  let session: Session | null;
  try {
    ({ session } = await steps.createAccount());
  } catch (error) {
    return { status: "failed", message: signupFailureMessage(error) };
  }

  if (!session) return { status: "created", message: signupSuccessMessage(null) };

  try {
    const result = await steps.startSession(session);
    if (result?.error) throw result.error;
  } catch {
    return { status: "created", message: SIGNUP_SIGN_IN_FAILED_COPY };
  }

  runBestEffort(() => steps.trackSignup(session));
  return { status: "created", message: signupSuccessMessage(session) };
}

/**
 * The sign-up request. `next` is her return path from `/login?redirect=…`,
 * re-checked here (the router leaves raw values in `useSearch()`) and again on
 * the server, which builds the confirmation link from it.
 */
export function signupRequest(
  values: { email: string; password: string; username: string },
  captchaToken: string,
  returnTo: unknown,
): { email: string; password: string; username: string; captchaToken: string; next?: string } {
  const next = safeRedirect(returnTo);
  return {
    email: values.email,
    password: values.password,
    username: values.username,
    captchaToken,
    ...(next ? { next } : {}),
  };
}
