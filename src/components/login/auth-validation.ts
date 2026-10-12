import { zodResolver } from "@hookform/resolvers/zod";
import type { DefaultValues, FieldValues, UseFormProps } from "react-hook-form";
import * as z from "zod";
import { passwordChecks } from "@/constants/password";

/**
 * The rules every auth form validates against, on blur and on submit.
 * `src/lib/auth-input.ts` is what the server enforces; the length, shape and
 * character rules here mirror it (and auth-validation.test.ts proves they
 * agree), so a field never passes here and then fails after the round trip.
 * Sign-up and reset are stricter than the server on purpose: they hold the new
 * password to the checklist shown under the field.
 */

const email = z
  .string()
  .trim()
  .min(1, { message: "Enter your email address." })
  .max(254, { message: "That email address is too long." })
  .email({ message: "Enter a valid email address." });

const username = z
  .string()
  .min(1, { message: "Choose a username." })
  .min(3, { message: "Username must be at least 3 characters." })
  .max(30, { message: "Username must be 30 characters or fewer." })
  .regex(/^[a-zA-Z0-9_-]+$/, { message: "Letters, numbers, underscores and dashes only." });

function lowerFirst(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** What is still missing from a new password, or undefined once it meets every check. */
export function passwordRequirementsError(password: string): string | undefined {
  const unmet = passwordChecks.filter((check) => !check.test(password));
  if (unmet.length === 0) return undefined;
  return `Still needed: ${unmet.map((check) => lowerFirst(check.label)).join(", ")}.`;
}

/** A password being chosen (sign-up, reset): held to the checklist, not just a length. */
function newPassword(emptyMessage: string) {
  return z
    .string()
    .min(1, { message: emptyMessage })
    .max(128, { message: "Password must be 128 characters or fewer." })
    .superRefine((value, ctx) => {
      if (value.length === 0) return;
      const message = passwordRequirementsError(value);
      if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    });
}

export const loginSchema = z.object({
  email,
  // An existing member's password is only ever checked against the server's limits.
  password: z
    .string()
    .min(1, { message: "Enter your password." })
    .min(8, { message: "Password must be at least 8 characters." })
    .max(128, { message: "Password must be 128 characters or fewer." }),
});

export const signupSchema = z.object({
  username,
  email,
  password: newPassword("Choose a password."),
});

export const forgotPasswordSchema = z.object({ email });

export const setNewPasswordSchema = z
  .object({
    password: newPassword("Choose a new password."),
    confirmPassword: z.string().min(1, { message: "Confirm your new password." }),
  })
  .superRefine((data, ctx) => {
    if (data.confirmPassword.length > 0 && data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passwords do not match.",
        path: ["confirmPassword"],
      });
    }
  });

/**
 * Options shared by every auth form. `onTouched` validates a field the first
 * time it loses focus and on every change after that, so a member sees the
 * message under the field they just left, and sees it clear as they fix it.
 * src: https://react-hook-form.com/docs/useform#mode · react-hook-form 7.80.0
 */
export function authFormOptions<TValues extends FieldValues>(
  schema: z.ZodType<TValues, z.ZodTypeDef, TValues> & { _def: { typeName: string } },
  defaultValues: DefaultValues<TValues>,
): UseFormProps<TValues> {
  return { mode: "onTouched", resolver: zodResolver(schema), defaultValues };
}

/** Builds an `aria-describedby` value from the ids that apply, or none. */
export function describedBy(...ids: Array<string | false | null | undefined>): string | undefined {
  const joined = ids.filter(Boolean).join(" ");
  return joined || undefined;
}
