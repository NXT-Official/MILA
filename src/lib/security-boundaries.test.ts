import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

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

test("all hCaptcha forms clear expired/error tokens and reset after attempts", () => {
  for (const path of [
    "../components/login/login-form.tsx",
    "../components/login/signup-form.tsx",
    "../components/login/support-dialog.tsx",
  ]) {
    const component = source(path);
    expect(component).toContain("onExpire={() => setCaptchaToken(null)}");
    expect(component).toContain("onError={() => setCaptchaToken(null)}");
    expect(component).toContain("captchaRef.current?.resetCaptcha()");
    expect(component).toContain("setCaptchaToken(null)");
  }
});
