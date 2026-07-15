import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { requireEnv } from "./env";
import { accountKey, clientIp, consumeRateLimit, RATE_LIMIT_POLICIES } from "./rate-limit.server";

const Credentials = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(128),
    captchaToken: z.string().min(1).max(4000),
  })
  .strict();
const Signup = Credentials.extend({
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/),
}).strict();

function authClient() {
  const env = requireEnv({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  });
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function identities(email: string, operation: "login" | "signup") {
  const ip = clientIp(getRequest());
  if (!ip) throw new Error("Unable to verify this request.");
  const prefix = operation === "login" ? "auth:login" : "auth:signup";
  await consumeRateLimit(
    `${prefix}:ip`,
    ip,
    operation === "login" ? RATE_LIMIT_POLICIES.loginIp : RATE_LIMIT_POLICIES.signupIp,
  );
  return { account: accountKey(email), prefix };
}

export const signInWithPassword = createServerFn({ method: "POST" })
  .validator((input: unknown) => Credentials.parse(input))
  .handler(async ({ data }) => {
    const identity = await identities(data.email, "login");
    await consumeRateLimit(
      `${identity.prefix}:account`,
      identity.account,
      RATE_LIMIT_POLICIES.loginAccount,
    );
    const result = await authClient().auth.signInWithPassword({
      email: data.email,
      password: data.password,
      options: { captchaToken: data.captchaToken },
    });
    if (result.error) {
      console.warn(JSON.stringify({ event: "authentication_failure", method: "password" }));
      throw new Error("Email, password, or verification challenge is invalid.");
    }
    return { session: result.data.session };
  });

export const signUpWithPassword = createServerFn({ method: "POST" })
  .validator((input: unknown) => Signup.parse(input))
  .handler(async ({ data }) => {
    const identity = await identities(data.email, "signup");
    await consumeRateLimit(
      `${identity.prefix}:account`,
      identity.account,
      RATE_LIMIT_POLICIES.signupAccount,
    );
    const result = await authClient().auth.signUp({
      email: data.email,
      password: data.password,
      options: { data: { username: data.username }, captchaToken: data.captchaToken },
    });
    if (result.error) throw new Error("Unable to create the account. Please try again later.");
    return { session: result.data.session };
  });
