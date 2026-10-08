import { test, expect, type Page } from "@playwright/test";

/**
 * Session survival in a real browser, against local dev with every Supabase
 * call answered by `page.route` (no keys, no network).
 *
 * Run it against a dev server whose Supabase URL is the one below, e.g.
 *   VITE_SUPABASE_URL=http://127.0.0.1:54931 SUPABASE_URL=http://127.0.0.1:54931 \
 *   VITE_SUPABASE_PUBLISHABLE_KEY=test SUPABASE_PUBLISHABLE_KEY=test bun run dev
 * then `E2E_BASE_URL=https://localhost:<port> bunx playwright test tests/e2e/auth-session.spec.ts`.
 * Nothing needs to listen on the Supabase URL: the browser's requests never
 * leave Playwright.
 */
const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54931";
// supabase-js default storage key: `sb-<first host label>-auth-token`.
// src: node_modules/@supabase/supabase-js/src/SupabaseClient.ts `defaultStorageKey` · 2.110.0
const STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
const USER_ID = "11111111-1111-4111-8111-111111111111";

if (process.env.E2E_BASE_URL) test.use({ baseURL: process.env.E2E_BASE_URL });

// The default `bun run test:e2e` starts a dev server on the real `.env`, where
// these mocks cannot answer: skip unless pointed at a fake-Supabase dev server.
test.skip(
  !process.env.E2E_BASE_URL,
  "needs a dev server on the fake Supabase URL and E2E_BASE_URL (see the header)",
);

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function makeSession(expiresInSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + expiresInSeconds;
  return {
    access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER_ID, exp, iat: now, role: "authenticated", aud: "authenticated" })}.sig`,
    token_type: "bearer",
    expires_in: expiresInSeconds,
    expires_at: exp,
    refresh_token: `rt-${now}-${Math.random().toString(36).slice(2)}`,
    user: {
      id: USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: "member@example.com",
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: "2026-01-01T00:00:00Z",
    },
  };
}

// A finished style profile, so the app does not route her to onboarding.
const PROFILE = {
  id: USER_ID,
  full_name: "Member",
  skin_undertone: "Warm",
  color_season: "Autumn",
  body_type: "Hourglass",
  face_shape: "Oval",
  hair_type: "Wavy",
  hair_length: "Medium",
  gender: "Female",
  skin_depth: "Medium",
  color_profile: { season: "Autumn" },
  beauty_preferences: [],
  suspended: false,
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD",
};

type RefreshMode = "ok" | "abort";

// 3 daily credits already reset today + 2 purchased = 5 effective credits.
const ENTITLEMENT = {
  ai_credits: 3,
  purchased_credits: 2,
  credits_reset_at: new Date().toISOString().slice(0, 10),
};

async function mockSupabase(page: Page, refresh: RefreshMode = "ok") {
  // anonymousReads: PostgREST reads sent with the publishable key instead of
  // her JWT (supabase-js falls back to the key when getSession() has none).
  const state = {
    refresh,
    outfitsRequests: 0,
    anonymousReads: 0,
    anonymousTables: [] as string[],
    // When true, PostgREST fails the profile read (network or server trouble).
    profilesFail: false,
  };
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        headers: CORS,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (url.pathname === "/auth/v1/token") {
      if (state.refresh === "abort") return route.abort("internetdisconnected");
      return json(makeSession(3600));
    }
    if (url.pathname === "/auth/v1/user") return json(makeSession(3600).user);
    if (url.pathname === "/auth/v1/logout") return route.fulfill({ status: 204, headers: CORS });
    if (url.pathname.startsWith("/rest/v1/")) {
      const wantsObject = (request.headers()["accept"] ?? "").includes("vnd.pgrst.object");
      // Our JWTs start with the base64url of `{"alg"`: "eyJ".
      const asMember = (request.headers()["authorization"] ?? "").startsWith("Bearer eyJ");
      if (!asMember) {
        // RLS shows an anonymous caller nothing.
        state.anonymousReads += 1;
        state.anonymousTables.push(url.pathname.replace("/rest/v1/", ""));
        return json(wantsObject ? null : []);
      }
      if (url.pathname === "/rest/v1/profiles") {
        if (state.profilesFail) return json({ message: "upstream unavailable" }, 503);
        return json(wantsObject ? PROFILE : [PROFILE]);
      }
      if (url.pathname === "/rest/v1/user_entitlements") {
        return json(wantsObject ? ENTITLEMENT : [ENTITLEMENT]);
      }
      if (url.pathname === "/rest/v1/outfits") state.outfitsRequests += 1;
      return json(wantsObject ? null : []);
    }
    return json({ message: "not found" }, 404);
  });
  return state;
}

async function seedSession(page: Page, session: ReturnType<typeof makeSession>) {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("e2e-seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("e2e-seeded", "1");
      }
    },
    [STORAGE_KEY, JSON.stringify(session)] as const,
  );
}

/** Records, from before first paint, whether the marketing landing was ever visible. */
async function watchForLanding(page: Page) {
  await page.addInitScript(() => {
    const check = () => {
      const landing = document.querySelector("main.overflow-x-clip");
      if (landing && getComputedStyle(landing).visibility !== "hidden") {
        sessionStorage.setItem("e2e-landing-seen", location.pathname);
      }
    };
    new MutationObserver(check).observe(document, { childList: true, subtree: true });
    const tick = () => {
      check();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return () => page.evaluate(() => sessionStorage.getItem("e2e-landing-seen"));
}

/** What `supabase.auth.setSession()` does after the login form: persist, then announce SIGNED_IN. */
async function signInLikeTheLoginForm(page: Page) {
  const session = makeSession(3600);
  await page.evaluate(
    ([key, value]) => {
      localStorage.setItem(key, value);
      // auth-js listens on a BroadcastChannel named after the storage key and
      // notifies its subscribers of what arrives there.
      new BroadcastChannel(key).postMessage({ event: "SIGNED_IN", session: JSON.parse(value) });
    },
    [STORAGE_KEY, JSON.stringify(session)] as const,
  );
}

async function waitForHydratedLoginForm(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector("#login-email");
    return !!el && Object.keys(el).some((key) => key.startsWith("__reactProps"));
  });
}

test.describe("signed-in member, landing page", () => {
  test("opening the site root goes straight to the dashboard without painting the landing", async ({
    page,
  }) => {
    await mockSupabase(page);
    await seedSession(page, makeSession(3600));
    const landingSeen = await watchForLanding(page);
    await page.goto("/");
    await page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 60_000 });
    expect(await landingSeen()).toBeNull();
  });

  test("a visitor without a session still gets the landing", async ({ page }) => {
    await mockSupabase(page);
    const landingSeen = await watchForLanding(page);
    await page.goto("/");
    await expect.poll(landingSeen, { timeout: 30_000 }).toBe("/");
  });
});

test.describe("return path", () => {
  test("a signed-out visit carries the page to /login, and sign-in brings her back to it", async ({
    page,
  }) => {
    await mockSupabase(page);
    const landingSeen = await watchForLanding(page);
    await page.goto("/history?look=abc");
    await page.waitForURL(
      (url) =>
        url.pathname === "/login" && url.searchParams.get("redirect") === "/history?look=abc",
      { timeout: 60_000 },
    );
    await waitForHydratedLoginForm(page);
    await signInLikeTheLoginForm(page);
    await page.waitForURL(
      (url) => url.pathname === "/history" && url.searchParams.get("look") === "abc",
      { timeout: 60_000 },
    );
    expect(await landingSeen()).toBeNull();
  });

  for (const redirect of ["//evil.example/steal", "/.//evil.example", "/a/..//evil.example"]) {
    test(`an off-site redirect is ignored: ${redirect} → sign-in goes to the dashboard`, async ({
      page,
    }) => {
      await mockSupabase(page);
      await page.goto(`/login?redirect=${encodeURIComponent(redirect)}`);
      const appOrigin = new URL(page.url()).origin;
      await waitForHydratedLoginForm(page);
      await signInLikeTheLoginForm(page);
      await page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 60_000 });
      expect(new URL(page.url()).origin).toBe(appOrigin);
    });
  }
});

test.describe("session survival", () => {
  test("an aborted token refresh at startup reconnects instead of sending her to /login", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // Lets the test skip auth-js's 60 s failed-refresh cooldown below.
    await page.clock.install();
    const backend = await mockSupabase(page, "abort");
    await seedSession(page, makeSession(-60)); // access token already expired
    await page.goto("/history");

    // auth-js retries the refresh with backoff for up to ~25 s, then reports a
    // retryable error. Before the fix that meant /login.
    await expect(page.getByRole("heading", { name: "Reconnecting" })).toBeVisible({
      timeout: 60_000,
    });
    expect(new URL(page.url()).pathname).toBe("/history");
    expect(await page.evaluate((key) => !!localStorage.getItem(key), STORAGE_KEY)).toBe(true);

    // The network comes back. Jump past the cooldown; the provider's retry
    // (or auth-js's own ticker) refreshes the stored session.
    backend.refresh = "ok";
    await page.clock.fastForward(65_000);
    await expect(page.getByRole("heading", { name: "Your archive." })).toBeVisible({
      timeout: 30_000,
    });
    expect(new URL(page.url()).pathname).toBe("/history");
  });

  test("returning to the tab keeps her page: no /login, no reload of her archive", async ({
    page,
  }) => {
    const backend = await mockSupabase(page);
    await seedSession(page, makeSession(3600));
    await page.goto("/history");
    await expect(page.getByRole("heading", { name: "Your archive." })).toBeVisible({
      timeout: 60_000,
    });
    await page.waitForTimeout(1000);
    const before = backend.outfitsRequests;
    expect(before).toBeGreaterThan(0);

    // Prove the trigger really fires: auth-js re-emits SIGNED_IN on tab return
    // and broadcasts it on its channel.
    await page.evaluate((key) => {
      const events: string[] = [];
      (window as unknown as { __authEvents: string[] }).__authEvents = events;
      new BroadcastChannel(key).onmessage = (e: MessageEvent<{ event: string }>) =>
        events.push(e.data.event);
    }, STORAGE_KEY);
    await page.evaluate(() => {
      const set = (state: DocumentVisibilityState) =>
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => state,
        });
      set("hidden");
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
      set("visible");
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    });
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __authEvents: string[] }).__authEvents),
      )
      .toContain("SIGNED_IN");

    await page.waitForTimeout(1500);
    expect(backend.outfitsRequests).toBe(before);
    expect(new URL(page.url()).pathname).toBe("/history");
    await expect(page.getByRole("heading", { name: "Your archive." })).toBeVisible();
  });

  test("Try again reconnects at once when the network is back, no minute-long wait", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const backend = await mockSupabase(page, "abort");
    await seedSession(page, makeSession(-60)); // access token already expired
    await page.goto("/history");
    await expect(page.getByRole("heading", { name: "Reconnecting" })).toBeVisible({
      timeout: 60_000,
    });

    // The network is back. auth-js would hold the failure for 60 s; her tap
    // must not wait for that.
    backend.refresh = "ok";
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Your archive." })).toBeVisible({
      timeout: 10_000,
    });
    expect(new URL(page.url()).pathname).toBe("/history");
  });

  test("refresh failed, then window focus: her credits still show, never 0", async ({ page }) => {
    test.setTimeout(120_000);
    await page.clock.install();
    const backend = await mockSupabase(page);
    await seedSession(page, makeSession(3600));
    await page.goto("/dashboard");
    const credits = page
      .getByText("AI Credits", { exact: true })
      .locator("xpath=following-sibling::p[1]");
    await expect(credits).toHaveText("5", { timeout: 60_000 });
    expect(backend.anonymousReads).toBe(0);

    // An hour passes with the tab hidden; on return the refresh fails.
    backend.refresh = "abort";
    await page.clock.fastForward(3_700_000);
    await page.evaluate(() => {
      const set = (state: DocumentVisibilityState) =>
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => state,
        });
      set("hidden");
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
      set("visible");
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
      window.dispatchEvent(new Event("focus"));
    });
    // Let auth-js finish its refresh backoff (~25 s of sleeps between aborted
    // requests) so the refetch really runs while getSession() has no session.
    for (let i = 0; i < 30; i += 1) {
      await page.clock.runFor(2_000);
      await page.waitForTimeout(50);
    }
    // Precondition: the refetch did reach the point where supabase-js would
    // fall back to the publishable key (the refresh has failed by now).
    expect(await page.evaluate((key) => !!localStorage.getItem(key), STORAGE_KEY)).toBe(true);

    await expect(credits).toHaveText("5");
    expect(backend.anonymousTables).toEqual([]);
    expect(new URL(page.url()).pathname).toBe("/dashboard");
  });
});

test.describe("data never lost while the refresh is failing", () => {
  test("a failed profile read keeps a finished member where she is, with the try-again state (never onboarding)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const backend = await mockSupabase(page);
    backend.profilesFail = true;
    await seedSession(page, makeSession(3600));
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Reconnecting" })).toBeVisible({
      timeout: 60_000,
    });
    expect(new URL(page.url()).pathname).toBe("/dashboard");

    // The read works again: Try again brings her dashboard back, still no onboarding.
    backend.profilesFail = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("AI Credits", { exact: true })).toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).pathname).toBe("/dashboard");
  });

  test("Style Profile mid-session: no blank form, nothing written as anonymous, a calm note", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.clock.install();
    const backend = await mockSupabase(page);
    await seedSession(page, makeSession(3600));
    await page.goto("/dashboard");
    await expect(page.getByText("AI Credits", { exact: true })).toBeVisible({ timeout: 60_000 });

    // An hour later her token has expired and the refresh fails.
    backend.refresh = "abort";
    await page.clock.fastForward(3_700_000);
    await page.getByRole("link", { name: "Studio" }).first().click();
    // Let auth-js finish its refresh backoff so reads really run without a session.
    for (let i = 0; i < 30; i += 1) {
      await page.clock.runFor(2_000);
      await page.waitForTimeout(50);
    }

    await expect(page.getByRole("heading", { name: "Reconnecting", level: 2 })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Reconnecting. You're still signed in.")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/style-profile");
    // Nothing went out as anonymous: no empty profile read, no write.
    expect(backend.anonymousTables).toEqual([]);

    // The network is back: one tap on the note refreshes, and the page then
    // loads her real profile by itself. No second tap on the inline state (R-4).
    backend.refresh = "ok";
    await page
      .getByText("Reconnecting. You're still signed in.", { exact: true })
      .locator("..")
      .getByRole("button", { name: "Try again" })
      .click();
    await expect(page.getByText("Reconnecting. You're still signed in.")).toBeHidden({
      timeout: 30_000,
    });
    await expectStudioRecovered(page);
    expect(backend.anonymousTables).toEqual([]);
  });

  test("a page-level Try again forces a fresh refresh: no minute-long wait on auth-js's cached failure (R-4)", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.clock.install();
    const backend = await mockSupabase(page);
    // Her profile read fails, so the app layout shows its own try-again state.
    backend.profilesFail = true;
    await seedSession(page, makeSession(3600));
    await page.goto("/dashboard");
    const pageLevel = page.getByRole("heading", { name: "Reconnecting", level: 1 });
    await expect(pageLevel).toBeVisible({ timeout: 60_000 });

    // An hour later her token has expired and the refresh fails: auth-js now
    // answers every refresh from its 60 s failure cache.
    backend.refresh = "abort";
    await page.clock.fastForward(3_700_000);
    // Long enough for the backoff to give up (~25 s), short of the 60 s cache.
    await pumpClock(page, 36);
    await expect(page.getByText("Reconnecting. You're still signed in.")).toBeVisible({
      timeout: 30_000,
    });

    // Everything is back. Her tap on the page's own Try again (not the note's)
    // must reach the server now, inside that 60 s window.
    backend.refresh = "ok";
    backend.profilesFail = false;
    await pageLevel.locator("..").getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("AI Credits", { exact: true })).toBeVisible({ timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe("/dashboard");
    expect(backend.anonymousTables).toEqual([]);
  });
});

test.describe("phones", () => {
  test("the Reconnecting note sits above the tab bar at 375px: every tab stays tappable (R-5)", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.clock.install();
    const backend = await mockSupabase(page);
    await seedSession(page, makeSession(3600));
    await page.goto("/dashboard");
    await expect(page.getByText("AI Credits", { exact: true })).toBeVisible({ timeout: 60_000 });

    // An hour later the refresh fails; her credits refetch on focus is refused,
    // which raises the note.
    backend.refresh = "abort";
    await page.clock.fastForward(3_700_000);
    await returnToTab(page);
    await pumpClock(page);
    const note = page.getByText("Reconnecting. You're still signed in.", { exact: true });
    await expect(note).toBeVisible({ timeout: 30_000 });

    const tabBar = page
      .getByRole("navigation")
      .filter({ has: page.getByRole("button", { name: "Open Mila's Styling Studio" }) })
      .filter({ visible: true });
    await expect(tabBar).toHaveCount(1);
    const pill = await note.locator("..").boundingBox();
    const bar = await tabBar.boundingBox();
    if (!pill || !bar) throw new Error("note or tab bar has no box");
    expect(pill.y + pill.height).toBeLessThanOrEqual(bar.y);

    // What sits under the centre of every tab is that tab, never the note.
    const tabs = tabBar.locator(":scope > a, :scope > button");
    await expect(tabs).toHaveCount(5);
    for (const tab of await tabs.all()) {
      const onTop = await tab.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!hit && el.contains(hit);
      });
      expect(onTop).toBe(true);
    }

    // A centre tab really takes her tap while the note is up.
    await tabBar.getByRole("link", { name: "Studio" }).click();
    await page.waitForURL((url) => url.pathname === "/style-profile", { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Reconnecting", level: 2 })).toBeVisible({
      timeout: 30_000,
    });

    // One tap on the note once the network is back: Studio recovers by itself.
    backend.refresh = "ok";
    await note.locator("..").getByRole("button", { name: "Try again" }).click();
    await expect(note).toBeHidden({ timeout: 30_000 });
    await expectStudioRecovered(page);
    expect(backend.anonymousTables).toEqual([]);
  });
});

/** The tab goes hidden and comes back, and the window regains focus: React Query refetches. */
async function returnToTab(page: Page) {
  await page.evaluate(() => {
    const set = (state: DocumentVisibilityState) =>
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => state,
      });
    set("hidden");
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    set("visible");
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    window.dispatchEvent(new Event("focus"));
  });
}

/** Let auth-js finish its refresh backoff (~25 s of sleeps between aborted requests). */
async function pumpClock(page: Page, seconds = 60) {
  for (let i = 0; i < seconds / 2; i += 1) {
    await page.clock.runFor(2_000);
    await page.waitForTimeout(50);
  }
}

/** Her real profile is on screen: no inline Reconnecting, no loading line, no Try again left to tap. */
async function expectStudioRecovered(page: Page) {
  await expect(page.getByRole("heading", { name: "Reconnecting", level: 2 })).toBeHidden({
    timeout: 30_000,
  });
  await expect(page.getByText("Loading your profile…")).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/style-profile");
}
