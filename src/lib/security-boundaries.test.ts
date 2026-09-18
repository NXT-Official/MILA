import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("a suspended account is blocked in the member tree", () => {
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
  // or a member could claim someone else's photo as their OOTD. This check now
  // lives in the extracted service both the web `createPost` server function and
  // the mobile `POST /api/v1/posts/create` route share.
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

test("a moderator viewing a member profile can only see hidden posts through the checked path", () => {
  // Staff role/permission management now lives entirely in MILA_ADMIN; the only
  // surviving use of roles in this app is this read-only visibility check. It now
  // lives in the extracted service both the web `getMemberProfile` server
  // function and the mobile `GET /api/v1/profile/member` route share.
  const posts = source("../server/services/posts.ts");
  expect(posts).toContain("getCurrentUserRoles(supabase, userId)");
  expect(posts).toContain('hasPermission(roles, "moderation.view")');
});

test("the removed staff suite leaves no importable trace in the member app", () => {
  for (const path of [
    "@/lib/admin.functions",
    "@/lib/subscription-plans.functions",
    "@/lib/staff-route",
    "@/lib/queries/admin",
    "@/components/admin",
    "@/components/staff",
  ]) {
    for (const file of [
      "../components/landing/site-header.tsx",
      "../hooks/use-login-redirect.ts",
      "../lib/queries/auth.ts",
      "../routes/_authenticated/_app.tsx",
      "../routes/_authenticated/onboarding.tsx",
      "../routes/auth/callback.tsx",
      "../routes/login.tsx",
    ]) {
      expect(source(file)).not.toContain(path);
    }
  }
});
