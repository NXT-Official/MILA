import { z } from "zod";

export const Credentials = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(128),
    captchaToken: z.string().min(1).max(4000),
  })
  .strict();

export const Signup = Credentials.extend({
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/),
}).strict();

export type CredentialsInput = z.infer<typeof Credentials>;
export type SignupInput = z.infer<typeof Signup>;
