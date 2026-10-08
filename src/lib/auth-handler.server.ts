import { createClient, type Session } from "@supabase/supabase-js";
import { getRequestHeader, getRequestUrl } from "@tanstack/react-start/server";
import type { Database } from "@/integrations/supabase/types";
import { requireEnv } from "./env";
import {
  Credentials,
  Signup,
  RequestReset,
  NewPassword,
  type CredentialsInput,
  type SignupInput,
  type RequestResetInput,
  type NewPasswordInput,
} from "./auth-input";
import { captureServerException } from "./sentry.server";
import { authCallbackUrl } from "./safe-redirect";
import { authOriginConfig, pickAuthOrigin } from "./auth-origin";

type AuthOperation = "login" | "signup";

function authClient() {
  const env = requireEnv({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  });
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * The origin for links in auth emails. The request's own URL (the host Vercel
 * routed it to) is only a hint: it is used only when it is a known Mila
 * deployment, otherwise the deployment's canonical URL is. An unknown `Host`
 * or `X-Forwarded-Host` never reaches an email (`getRequestUrl({
 * xForwardedHost: true })` reads `X-Forwarded-Host`, so its value is validated
 * like any header). The browser `Origin` header never picks the deployment: a
 * real browser POST always sends a same-origin Origin (so it adds nothing),
 * and a link must stay on the deployment that served the request. It is
 * accepted here for callers but never decides.
 * // src: node_modules/@tanstack/start-server-core/src/request-response.ts
 * //      (getRequestHeader, getRequestUrl) · 1.169.39
 */
export function authRequestOrigin(
  request: { originHeader: string | undefined; requestUrlOrigin: string },
  env: Record<string, string | undefined> = process.env,
): string {
  return pickAuthOrigin([request.requestUrlOrigin], authOriginConfig(env));
}

function requestOrigin(): string {
  return authRequestOrigin({
    originHeader: getRequestHeader("origin"),
    requestUrlOrigin: getRequestUrl({ xForwardedHost: true, xForwardedProto: true }).origin,
  });
}

export type AuthDependencies = {
  client: typeof authClient;
  origin: typeof requestOrigin;
  /** Tells the member their password changed; must never fail the change. */
  notifyPasswordChanged: (userId: string) => Promise<unknown>;
};

async function notifyPasswordChanged(userId: string): Promise<unknown> {
  const [{ supabaseAdmin }, { sendPasswordChangedEmail }] = await Promise.all([
    import("@/integrations/supabase/client.server"),
    import("./account-emails.server"),
  ]);
  return sendPasswordChangedEmail(userId, { db: supabaseAdmin });
}

const defaults: AuthDependencies = {
  client: authClient,
  origin: requestOrigin,
  notifyPasswordChanged,
};

export async function authenticateWithPassword(
  operation: "login",
  data: CredentialsInput,
  deps?: AuthDependencies,
): Promise<{ session: Session | null }>;
export async function authenticateWithPassword(
  operation: "signup",
  data: SignupInput,
  deps?: AuthDependencies,
): Promise<{ session: Session | null }>;
export async function authenticateWithPassword(
  operation: AuthOperation,
  input: CredentialsInput | SignupInput,
  deps = defaults,
) {
  const data = operation === "login" ? Credentials.parse(input) : Signup.parse(input);
  const auth = deps.client().auth;
  const result =
    operation === "login"
      ? await auth.signInWithPassword({
          email: data.email,
          password: data.password,
          options: { captchaToken: data.captchaToken },
        })
      : await auth.signUp({
          email: data.email,
          password: data.password,
          options: {
            data: { username: (data as SignupInput).username },
            captchaToken: data.captchaToken,
            // The confirmation link returns to the deployment she signed up
            // on (the request origin), not the project's Site URL, and to the
            // page she was on.
            emailRedirectTo: authCallbackUrl(deps.origin(), (data as SignupInput).next),
          },
        });
  if (result.error) {
    captureServerException(result.error);
    if (operation === "login") {
      console.warn(JSON.stringify({ event: "authentication_failure", method: "password" }));
      throw new Error("Email, password, or verification challenge is invalid.");
    }
    throw new Error("Unable to create the account. Please try again later.");
  }
  return { session: result.data.session };
}

export async function requestPasswordReset(
  input: RequestResetInput,
  deps = defaults,
): Promise<{ ok: true }> {
  const data = RequestReset.parse(input);
  const auth = deps.client().auth;
  const { error } = await auth.resetPasswordForEmail(data.email, {
    redirectTo: `${deps.origin()}/auth/reset-password`,
    captchaToken: data.captchaToken,
  });
  if (error) {
    captureServerException(error);
    console.warn(JSON.stringify({ event: "password_reset_request_failure" }));
    throw new Error("Unable to send the reset link right now. Please try again later.");
  }
  // Supabase returns success regardless of whether the email is registered,
  // so this response never confirms or denies account existence.
  return { ok: true };
}

export async function updatePassword(
  input: NewPasswordInput,
  deps = defaults,
): Promise<{ ok: true }> {
  const data = NewPassword.parse(input);
  const client = deps.client();
  const { data: session, error: sessionError } = await client.auth.setSession({
    access_token: data.accessToken,
    refresh_token: data.refreshToken,
  });
  if (sessionError) {
    captureServerException(sessionError);
    console.warn(JSON.stringify({ event: "password_reset_session_invalid" }));
    throw new Error("Your reset link has expired. Please request a new one.");
  }
  const { error } = await client.auth.updateUser({ password: data.password });
  if (error) {
    captureServerException(error);
    console.warn(JSON.stringify({ event: "password_reset_update_failure" }));
    throw new Error("Unable to update your password. Please try again.");
  }
  // The member must hear about a password change even when it wasn't theirs.
  // Best effort: the password is already changed.
  if (session?.user?.id) {
    await deps
      .notifyPasswordChanged(session.user.id)
      .catch((cause) => captureServerException(cause));
  }
  return { ok: true };
}
