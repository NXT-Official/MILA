import { createServerFn } from "@tanstack/react-start";
import { Credentials, Signup, RequestReset, NewPassword } from "./auth-input";

export const signInWithPassword = createServerFn({ method: "POST" })
  .validator((input: unknown) => Credentials.parse(input))
  .handler(async ({ data }) =>
    (await import("./auth-handler.server")).authenticateWithPassword("login", data),
  );

export const signUpWithPassword = createServerFn({ method: "POST" })
  .validator((input: unknown) => Signup.parse(input))
  .handler(async ({ data }) =>
    (await import("./auth-handler.server")).authenticateWithPassword("signup", data),
  );

export const requestPasswordReset = createServerFn({ method: "POST" })
  .validator((input: unknown) => RequestReset.parse(input))
  .handler(async ({ data }) => (await import("./auth-handler.server")).requestPasswordReset(data));

export const updatePassword = createServerFn({ method: "POST" })
  .validator((input: unknown) => NewPassword.parse(input))
  .handler(async ({ data }) => (await import("./auth-handler.server")).updatePassword(data));
