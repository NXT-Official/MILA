import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("no route in the member app points at the staff suite", () => {
  // The staff suite lives in its own codebase on its own origin. A link or
  // redirect from here would hand its entry point to anyone who found this app.
  for (const path of [
    "../routes/login.tsx",
    "../routes/auth/callback.tsx",
    "../routes/index.tsx",
    "../components/landing/site-header.tsx",
    "../components/layout/app-shell.tsx",
  ]) {
    const file = source(path);
    expect(file).not.toContain("/admin");
    expect(file).not.toContain("/moderator");
  }
});

test("a suspended account is blocked from the authenticated tree", () => {
  expect(source("../routes/_authenticated.tsx")).toContain("<SuspendedGate>");
});

test("browser Supabase client never imports or reads the service-role credential", () => {
  const client = source("../integrations/supabase/client.ts");
  expect(client).not.toContain("SERVICE_ROLE");
  expect(client).toContain("VITE_SUPABASE_PUBLISHABLE_KEY");
});

test("password auth stays server-side and delegates abuse limits to Supabase Auth", () => {
  const auth = source("./auth-handler.server.ts");
  expect(auth).toContain("signInWithPassword");
  expect(auth).not.toContain("consumeRateLimit");
  expect(auth).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
});

test("the shared captcha hook clears expired/error tokens and resets after attempts", () => {
  const hook = source("../components/login/use-captcha.tsx");
  expect(hook).toContain("onExpire={clear}");
  expect(hook).toContain("onError={clear}");
  expect(hook).toContain("ref.current?.resetCaptcha()");
  expect(hook).toContain("setToken(null)");
});

test("publishing a post refuses image paths outside the poster's own storage folder", () => {
  // Storage RLS only constrains uploads, so the insert has to re-check ownership
  // or a member could claim someone else's photo as their OOTD. The check lives
  // in the shared service, so it holds for the website and for /api/v1 alike —
  // which is also why this assertion follows it there rather than relaxing.
  expect(source("../server/services/posts.ts")).toContain("path.startsWith(`${userId}/`)");
  // ...and the uploader must keep writing paths that satisfy that prefix.
  expect(source("./publish-ootd.ts")).toContain("`${userId}/back-");
  expect(source("./publish-ootd.ts")).toContain("`${userId}/front-");
});

test("every hCaptcha form goes through that hook rather than mounting its own widget", () => {
  for (const path of [
    "../components/login/login-form.tsx",
    "../components/login/signup-form.tsx",
    "../components/login/support-dialog.tsx",
  ]) {
    const component = source(path);
    expect(component).toContain("useCaptcha()");
    expect(component).toContain("captcha.reset()");
    // A form that renders its own <HCaptcha> would bypass the reset above and
    // silently reuse a spent, single-use token on the next attempt.
    expect(component).not.toContain("<HCaptcha");
  }
});

test("the feed withholds other members' posts until the viewer has posted today", () => {
  // A client-side blur would still ship every signed image URL to a lurker, so
  // the early return has to sit above the rows query, not in the component.
  const feed = source("../server/services/posts.ts");
  const handler = feed.slice(feed.indexOf("export async function loadFeed"));
  const gate = handler.indexOf("if (!todayCount) return { has_posted_today: false, posts: [] };");
  expect(gate).toBeGreaterThan(-1);
  expect(gate).toBeLessThan(handler.indexOf("createSignedUrls"));
});
