import { getRequest } from "@tanstack/react-start/server";
import { createClient, type Session } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireEnv } from "./env";
import { Credentials, Signup, type CredentialsInput, type SignupInput } from "./auth-input";
import { accountKey, clientIp, consumeRateLimit, RATE_LIMIT_POLICIES } from "./rate-limit.server";

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

export type AuthDependencies = {
  ip: () => string | undefined;
  consume: typeof consumeRateLimit;
  key: typeof accountKey;
  client: typeof authClient;
};

const defaults: AuthDependencies = {
  ip: () => clientIp(getRequest()),
  consume: consumeRateLimit,
  key: accountKey,
  client: authClient,
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
  const ip = deps.ip();
  if (!ip) throw new Error("Unable to verify this request.");
  const prefix = operation === "login" ? "auth:login" : "auth:signup";
  await deps.consume(
    `${prefix}:ip`,
    ip,
    operation === "login" ? RATE_LIMIT_POLICIES.loginIp : RATE_LIMIT_POLICIES.signupIp,
  );
  await deps.consume(
    `${prefix}:account`,
    deps.key(data.email),
    operation === "login" ? RATE_LIMIT_POLICIES.loginAccount : RATE_LIMIT_POLICIES.signupAccount,
  );
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
