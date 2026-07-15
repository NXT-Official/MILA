import { createServerFn } from "@tanstack/react-start";
import { Credentials, Signup } from "./auth-input";

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
