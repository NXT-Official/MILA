import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Session } from "@supabase/supabase-js";
import { AuthContext } from "@/hooks/use-auth";
import { AuthConnectionContext } from "@/hooks/use-auth-connection";
import type { AuthStatus } from "@/lib/auth-session";
import { LandingMemberGate } from "./landing-member-gate";

const session = {
  access_token: "a",
  refresh_token: "r",
  expires_in: 3600,
  expires_at: 1_900_000_000,
  token_type: "bearer",
  user: { id: "u1", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "" },
} as Session;

function render(status: AuthStatus, withSession: boolean) {
  return renderToStaticMarkup(
    <AuthConnectionContext.Provider value={{ status, retryNow: () => {}, refreshNow: () => {} }}>
      <AuthContext.Provider
        value={{
          user: withSession ? session.user : null,
          session: withSession ? session : null,
          loading: status === "loading" || status === "reconnecting",
          signingOut: false,
          signOut: async () => {},
        }}
      >
        <LandingMemberGate>
          <main data-testid="landing">Your stylist. Every morning.</main>
        </LandingMemberGate>
      </AuthContext.Provider>
    </AuthConnectionContext.Provider>,
  );
}

describe("LandingMemberGate", () => {
  test("a signed-in member never gets the landing, only the splash, while she is sent on", () => {
    const html = render("signed-in", true);
    expect(html).not.toContain("Your stylist. Every morning.");
    expect(html).not.toContain("data-landing-root");
    expect(html).toContain("ATELIER");
  });

  test("a visitor gets the landing, wrapped so a pre-paint member check can hide it", () => {
    const html = render("signed-out", false);
    expect(html).toContain("Your stylist. Every morning.");
    expect(html).toMatch(/<div data-landing-root="">\s*<main/);
  });

  test("while the session is still loading the server and client render the same landing markup", () => {
    const html = render("loading", false);
    expect(html).toContain("data-landing-root");
    // The splash an arriving member sees instead is rendered too, hidden by
    // default (display:none, so also hidden from assistive tech); the
    // pre-paint style only shows it for an arriving member.
    expect(html).toContain('data-member-splash=""');
  });
});
