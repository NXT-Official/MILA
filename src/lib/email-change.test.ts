import { describe, expect, test } from "bun:test";
import { requestEmailChange } from "./email-change";

function fakeAuth(result: { error: unknown } = { error: null }) {
  const calls: unknown[][] = [];
  return {
    calls,
    auth: {
      updateUser: async (...args: unknown[]) => {
        calls.push(args);
        return { data: { user: null }, ...result };
      },
    },
  };
}

describe("requestEmailChange", () => {
  test("the confirmation link returns her to this deployment's account page", async () => {
    // Without emailRedirectTo Supabase uses the Site URL: the live site, even
    // when she changed her email on a preview.
    const { auth, calls } = fakeAuth();
    await requestEmailChange(
      auth as never,
      "  new@example.com ",
      "https://mila-nicoledev.vercel.app",
    );
    expect(calls).toEqual([
      [
        { email: "new@example.com" },
        {
          emailRedirectTo: "https://mila-nicoledev.vercel.app/auth/callback?next=%2Faccount",
        },
      ],
    ]);
  });

  test("hands back Supabase's error for the form to show", async () => {
    const error = new Error("email rate limit exceeded");
    const { auth } = fakeAuth({ error });
    expect(
      await requestEmailChange(auth as never, "new@example.com", "https://mila.example"),
    ).toEqual({
      error,
    });
  });
});
