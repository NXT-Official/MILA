import { describe, expect, test } from "bun:test";
import type * as z from "zod";
import { passwordChecks } from "@/constants/password";
import { Credentials, RequestReset, Signup } from "@/lib/auth-input";
import {
  authFormOptions,
  describedBy,
  forgotPasswordSchema,
  loginSchema,
  passwordRequirementsError,
  setNewPasswordSchema,
  signupSchema,
} from "./auth-validation";

const STRONG = "Abcdefghij1!";
const CAPTCHA = "captcha-token";

/** The message shown under `path`, or undefined when that field passes. */
function messageAt(schema: z.ZodTypeAny, input: unknown, path: string): string | undefined {
  const result = schema.safeParse(input);
  if (result.success) return undefined;
  return result.error.issues.find((issue) => issue.path.join(".") === path)?.message;
}

describe("email rules", () => {
  const email = (value: string) => messageAt(forgotPasswordSchema, { email: value }, "email");

  test("an empty field asks for the address instead of calling it invalid", () => {
    expect(email("")).toBe("Enter your email address.");
    expect(email("   ")).toBe("Enter your email address.");
  });

  test("something that is not an address says so", () => {
    expect(email("nicole")).toBe("Enter a valid email address.");
    expect(email("nicole@")).toBe("Enter a valid email address.");
  });

  test("surrounding spaces are ignored, as the server ignores them", () => {
    expect(email("  nicole@example.com ")).toBeUndefined();
  });

  test("an address longer than the server accepts is refused here too", () => {
    expect(email(`${"a".repeat(250)}@example.com`)).toBe("That email address is too long.");
  });
});

describe("login rules", () => {
  const password = (value: string) =>
    messageAt(loginSchema, { email: "a@example.com", password: value }, "password");

  test("an empty password asks for it", () => {
    expect(password("")).toBe("Enter your password.");
  });

  test("a password the server would refuse is refused before the round trip", () => {
    expect(password("short")).toBe("Password must be at least 8 characters.");
    expect(password("x".repeat(129))).toBe("Password must be 128 characters or fewer.");
  });

  test("login never demands the new-password strength rules from an existing member", () => {
    expect(password("alllowercase")).toBeUndefined();
  });
});

describe("sign-up username rules", () => {
  const username = (value: string) =>
    messageAt(
      signupSchema,
      { username: value, email: "a@example.com", password: STRONG },
      "username",
    );

  test("each rule has its own message", () => {
    expect(username("")).toBe("Choose a username.");
    expect(username("ab")).toBe("Username must be at least 3 characters.");
    expect(username("a".repeat(31))).toBe("Username must be 30 characters or fewer.");
    expect(username("has space")).toBe("Letters, numbers, underscores and dashes only.");
  });

  test("a valid handle passes", () => {
    expect(username("atelier_handle-1")).toBeUndefined();
  });
});

describe("sign-up password rules", () => {
  const password = (value: string) =>
    messageAt(
      signupSchema,
      { username: "mila_user", email: "a@example.com", password: value },
      "password",
    );

  test("an empty password asks for one", () => {
    expect(password("")).toBe("Choose a password.");
  });

  test("a weak password lists exactly what is still missing", () => {
    expect(password("short")).toBe(
      "Still needed: at least 12 characters, one uppercase letter, one digit, one symbol.",
    );
    expect(password("abcdefghijkl")).toBe(
      "Still needed: one uppercase letter, one digit, one symbol.",
    );
  });

  test("the schema and the checklist under the field can never disagree", () => {
    const samples = [
      "",
      "short",
      "abcdefghijkl",
      "ABCDEFGHIJKL1!",
      "Abcdefghijkl!",
      "Abcdefghijkl1",
      STRONG,
      "Zz9!zzzzzzzz",
      "Zz9!zzzzzzz",
    ];
    for (const sample of samples) {
      const checklistPasses = passwordChecks.every((check) => check.test(sample));
      expect({ sample, accepted: password(sample) === undefined }).toEqual({
        sample,
        accepted: checklistPasses,
      });
    }
  });

  test("a password with every requirement met has no message", () => {
    expect(passwordRequirementsError(STRONG)).toBeUndefined();
  });
});

describe("the form checks agree with what the server accepts", () => {
  const emails = [
    "",
    "nicole",
    "nicole@",
    "a@example.com",
    ` a@example.com `,
    `${"a".repeat(250)}@example.com`,
  ];
  const usernames = ["", "ab", "abc", "a".repeat(30), "a".repeat(31), "has space", "ok_name-1"];
  const passwords = ["", "short", "12345678", "x".repeat(128), "x".repeat(129), STRONG];

  test("email: forgot-password form and server accept the same inputs", () => {
    for (const email of emails) {
      const form = forgotPasswordSchema.safeParse({ email }).success;
      const server = RequestReset.safeParse({ email, captchaToken: CAPTCHA }).success;
      expect({ email, form }).toEqual({ email, form: server });
    }
  });

  test("login: form and server accept the same inputs", () => {
    for (const email of emails) {
      for (const password of passwords) {
        const form = loginSchema.safeParse({ email, password }).success;
        const server = Credentials.safeParse({ email, password, captchaToken: CAPTCHA }).success;
        expect({ email, password, form }).toEqual({ email, password, form: server });
      }
    }
  });

  test("sign-up: the form is never looser than the server", () => {
    for (const username of usernames) {
      for (const email of emails) {
        for (const password of passwords) {
          const form = signupSchema.safeParse({ username, email, password }).success;
          const server = Signup.safeParse({
            username,
            email,
            password,
            captchaToken: CAPTCHA,
          }).success;
          if (form)
            expect({ username, email, password, server }).toEqual({
              username,
              email,
              password,
              server: true,
            });
        }
      }
    }
  });

  test("sign-up: username rules match the server exactly", () => {
    for (const username of usernames) {
      const form = signupSchema.safeParse({
        username,
        email: "a@example.com",
        password: STRONG,
      }).success;
      const server = Signup.safeParse({
        username,
        email: "a@example.com",
        password: STRONG,
        captchaToken: CAPTCHA,
      }).success;
      expect({ username, form }).toEqual({ username, form: server });
    }
  });
});

describe("set-new-password rules", () => {
  const input = (password: string, confirmPassword: string) => ({ password, confirmPassword });

  test("a weak new password lists what is missing", () => {
    expect(messageAt(setNewPasswordSchema, input("short", "short"), "password")).toBe(
      "Still needed: at least 12 characters, one uppercase letter, one digit, one symbol.",
    );
  });

  test("an empty new password asks for one", () => {
    expect(messageAt(setNewPasswordSchema, input("", ""), "password")).toBe(
      "Choose a new password.",
    );
  });

  test("an empty confirmation asks for it and does not also call it a mismatch", () => {
    expect(messageAt(setNewPasswordSchema, input(STRONG, ""), "confirmPassword")).toBe(
      "Confirm your new password.",
    );
  });

  test("a mismatch is reported under the confirmation field", () => {
    expect(messageAt(setNewPasswordSchema, input(STRONG, `${STRONG}x`), "confirmPassword")).toBe(
      "Passwords do not match.",
    );
  });

  test("a mismatch is still reported while the new password itself is weak", () => {
    expect(messageAt(setNewPasswordSchema, input("short", "shorty"), "confirmPassword")).toBe(
      "Passwords do not match.",
    );
  });

  test("matching strong passwords pass", () => {
    expect(setNewPasswordSchema.safeParse(input(STRONG, STRONG)).success).toBe(true);
  });
});

describe("describedBy", () => {
  test("joins the ids that exist and drops the rest", () => {
    expect(describedBy("a-error", false, "a-rules")).toBe("a-error a-rules");
    expect(describedBy(undefined, null, "a-rules")).toBe("a-rules");
  });

  test("returns undefined when nothing describes the field", () => {
    expect(describedBy(false, undefined)).toBeUndefined();
  });
});

describe("authFormOptions", () => {
  test("validates a field the first time it loses focus, then as the member types", () => {
    const options = authFormOptions(loginSchema, { email: "", password: "" });
    expect(options.mode).toBe("onTouched");
  });

  test("hands the schema to the resolver and keeps the starting values", async () => {
    const options = authFormOptions(loginSchema, { email: "a@example.com", password: "" });
    expect(options.defaultValues).toEqual({ email: "a@example.com", password: "" });
    const result = await options.resolver!({ email: "nope", password: "" }, undefined, {
      fields: {},
      shouldUseNativeValidation: false,
    });
    expect(Object.keys(result.errors)).toEqual(["email", "password"]);
  });
});
