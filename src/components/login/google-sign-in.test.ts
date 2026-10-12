import { describe, expect, test } from "bun:test";
import { startGoogleSignIn } from "./google-sign-in";

function fakeAuth(result: { error: unknown } = { error: null }) {
  const calls: unknown[] = [];
  return {
    calls,
    auth: {
      signInWithOAuth: async (credentials: unknown) => {
        calls.push(credentials);
        return { data: {}, ...result };
      },
    },
  };
}

describe("startGoogleSignIn", () => {
  test("returns her to the deployment she is on and to the page she was on", async () => {
    const { auth, calls } = fakeAuth();
    await startGoogleSignIn(
      auth as never,
      "https://mila-nicoledev.vercel.app",
      "/history?look=abc",
    );
    expect(calls).toEqual([
      {
        provider: "google",
        options: {
          redirectTo:
            "https://mila-nicoledev.vercel.app/auth/callback?next=%2Fhistory%3Flook%3Dabc",
        },
      },
    ]);
  });

  test("no return path, or an unsafe one: the dashboard", async () => {
    const { auth, calls } = fakeAuth();
    await startGoogleSignIn(auth as never, "https://mila.example", undefined);
    await startGoogleSignIn(auth as never, "https://mila.example", "//evil.example");
    expect(calls).toEqual([
      {
        provider: "google",
        options: { redirectTo: "https://mila.example/auth/callback?next=%2Fdashboard" },
      },
      {
        provider: "google",
        options: { redirectTo: "https://mila.example/auth/callback?next=%2Fdashboard" },
      },
    ]);
  });

  test("hands back Supabase's error so the card can say so", async () => {
    const error = new Error("provider disabled");
    const { auth } = fakeAuth({ error });
    expect(await startGoogleSignIn(auth as never, "https://mila.example", undefined)).toEqual({
      error,
    });
  });
});
