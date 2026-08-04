import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the /admin tree gates on an admin-only permission, /moderator on staff access", () => {
  // canAccessStaffArea is admin.access, which moderators hold — using it to guard
  // /admin would put a moderator back inside the admin tree.
  const admin = source("../routes/_authenticated/admin.tsx");
  expect(admin).toContain('hasPermission(viewer.roles, "admin.dashboard.view")');
  expect(admin).not.toContain("viewer.canAccessStaffArea");

  const moderator = source("../routes/_authenticated/moderator.tsx");
  expect(moderator).toContain("viewer.canAccessStaffArea");
});

test("moderation and support are mounted twice but implemented once", () => {
  for (const [screen, component] of [
    ["moderation", "ModerationPage"],
    ["support", "SupportPage"],
  ]) {
    for (const tree of ["admin", "moderator"]) {
      const route = source(`../routes/_authenticated/${tree}/${screen}.tsx`);
      // Each route file must delegate; a copy-pasted page body would drift.
      expect(route).toContain(`import { ${component} } from "@/components/staff/${screen}-page"`);
      expect(route).toContain(`component: ${component}`);
      expect(route).toContain(`createFileRoute("/_authenticated/${tree}/${screen}")`);
    }
  }
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
  // or a member could claim someone else's photo as their OOTD.
  expect(source("./posts.functions.ts")).toContain("path.startsWith(`${userId}/`)");
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
