import { createClient, type Session } from "@supabase/supabase-js";
import { getRequestUrl } from "@tanstack/react-start/server";
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

function requestOrigin(): string {
  return getRequestUrl({ xForwardedHost: true, xForwardedProto: true }).origin;
}

export type AuthDependencies = {
  client: typeof authClient;
  origin: typeof requestOrigin;
};

const defaults: AuthDependencies = {
  client: authClient,
  origin: requestOrigin,
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
          },
        });
  if (result.error) {
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
  const { error: sessionError } = await client.auth.setSession({
    access_token: data.accessToken,
    refresh_token: data.refreshToken,
  });
  if (sessionError) {
    console.warn(JSON.stringify({ event: "password_reset_session_invalid" }));
    throw new Error("Your reset link has expired. Please request a new one.");
  }
  const { error } = await client.auth.updateUser({ password: data.password });
  if (error) {
    console.warn(JSON.stringify({ event: "password_reset_update_failure" }));
    throw new Error("Unable to update your password. Please try again.");
  }
  return { ok: true };
}
