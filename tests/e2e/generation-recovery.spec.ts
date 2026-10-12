import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * R7 in a real browser: a look being composed survives leaving the page, a
 * reload, and a double press, against local dev with every Supabase call
 * answered by `page.route` and the look's server function held open (no AI
 * keys, no network). Its job row (`/rest/v1/generation_jobs`) is scripted.
 *
 * Run it against a dev server whose Supabase URL is the one below, e.g.
 *   VITE_SUPABASE_URL=http://127.0.0.1:54931 SUPABASE_URL=http://127.0.0.1:54931 \
 *   VITE_SUPABASE_PUBLISHABLE_KEY=test SUPABASE_PUBLISHABLE_KEY=test bun run dev
 * then `E2E_BASE_URL=https://localhost:<port> bunx playwright test tests/e2e/generation-recovery.spec.ts`.
 * Nothing needs to listen on the Supabase URL: the browser's requests never
 * leave Playwright.
 */
const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54931";
// supabase-js default storage key: `sb-<first host label>-auth-token`.
// src: node_modules/@supabase/supabase-js/src/SupabaseClient.ts `defaultStorageKey` · 2.110.0
const STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
const USER_ID = "11111111-1111-4111-8111-111111111111";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

if (process.env.E2E_BASE_URL) test.use({ baseURL: process.env.E2E_BASE_URL });

// The dev server's HMR socket (`wss://host/?token=…`) reloads the page whenever
// any file in the shared tree changes, which would tear a case down midway. A
// silent mock keeps the socket open and sends nothing, so no reload arrives
// (as tests/e2e/landing-stack.spec.ts does).
// src: https://playwright.dev/docs/api/class-websocketroute ("by default, the
// routed WebSocket will not connect to the server") · @playwright/test 1.63
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/[?&]token=/, () => {});
});

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

// A finished style profile (so the dashboard lets her create a look), with no
// consented photo, so a look does not go on to render a style sheet.
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
  photo_consent_at: null,
};

const ENTITLEMENT = {
  ai_credits: 3,
  purchased_credits: 2,
  credits_reset_at: new Date().toISOString().slice(0, 10),
};

// The look the server stores as the job's result.
const LOOK = {
  outfit: {
    headline: "The Quiet Linen Edit",
    description: "A sand linen shirt over wide ivory trousers, finished with tan loafers.",
    styling_notes: "Half-tuck the shirt and roll the sleeves twice.",
  },
  hair: { style: "Soft waves", execution_tip: "Air dry with a light cream." },
  makeup: null,
  vibe_alignment_score: 8,
  shoppable_picks: [],
  forecastRetrievedAt: null,
};

// A newer look her phone made, which must never cover her own paid look here.
const PHONE_LOOK = {
  ...LOOK,
  outfit: {
    headline: "The Weekend Denim Edit",
    description: "A washed denim jacket over a white tee and straight black jeans.",
    styling_notes: "Roll the jacket sleeves once.",
  },
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD",
};

type JobRow = Record<string, unknown>;

async function mockBackend(page: Page, jobs: "live" | "missing") {
  const state = {
    jobs,
    rows: [] as JobRow[],
    jobsReads: 0,
    /** Every look request the browser sent, with the request id it carried. */
    lookPosts: [] as Array<{ id: string | null }>,
    /** Look requests held open (never answered): the server is "still composing". */
    held: [] as Route[],
    /** When set, the next look request fails as a dropped connection. */
    dropNextLook: false,
    /** When set, the next look request gets a real error answer from the server. */
    failNextLook: false,
    /** When set, the next look request gets a gateway page (502), not Mila's answer. */
    gatewayNextLook: false,
    /** While above 0, each read of her ids by request id fails (and counts down). */
    failOwnReads: 0,
    /** Delay before each generation_jobs answer (a slow first read after a reload). */
    jobsDelayMs: 0,
    /** Headlines she has saved to her history (`outfits`). */
    savedHeadlines: [] as string[],
  };

  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route
        .fulfill({
          status,
          headers: CORS,
          contentType: "application/json",
          body: JSON.stringify(body),
        })
        // A delayed answer may find its request already given up (the page's
        // time limit) or the page closed: nothing is waiting for it then.
        .catch(() => {});
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (url.pathname === "/auth/v1/token") return json(makeSession(3600));
    if (url.pathname === "/auth/v1/user") return json(makeSession(3600).user);
    if (url.pathname === "/auth/v1/logout") return route.fulfill({ status: 204, headers: CORS });
    if (url.pathname.startsWith("/rest/v1/")) {
      const wantsObject = (request.headers()["accept"] ?? "").includes("vnd.pgrst.object");
      // Our JWTs start with the base64url of `{"alg"`: "eyJ". RLS shows an
      // anonymous caller nothing.
      if (!(request.headers()["authorization"] ?? "").startsWith("Bearer eyJ")) {
        return json(wantsObject ? null : []);
      }
      if (url.pathname === "/rest/v1/outfits") {
        // The saved-look check: `analysis_result->outfit->>headline=eq.<headline>`.
        const headline = url.searchParams.get("analysis_result->outfit->>headline");
        const saved = !!headline && state.savedHeadlines.includes(headline.replace(/^eq\./, ""));
        return json(saved ? [{ id: "44444444-0000-4000-8000-000000000001" }] : []);
      }
      if (url.pathname === "/rest/v1/generation_jobs") {
        state.jobsReads += 1;
        if (state.jobsDelayMs > 0) await new Promise((r) => setTimeout(r, state.jobsDelayMs));
        if (state.jobs === "missing") {
          return json(
            {
              code: "PGRST205",
              message: "Could not find the table 'public.generation_jobs' in the schema cache",
              details: null,
              hint: null,
            },
            404,
          );
        }
        const kind = (url.searchParams.get("kind") ?? "").replace(/^eq\./, "");
        const newestFirst = state.rows
          .filter((row) => row.kind === kind)
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        // Her unanswered presses read by id: `client_request_id=in.(a,b)`
        // (values may be double-quoted).
        const ids = url.searchParams.get("client_request_id");
        if (ids?.startsWith("in.(") && state.failOwnReads > 0) {
          state.failOwnReads -= 1;
          return json(
            { code: "XX000", message: "upstream unavailable", details: null, hint: null },
            503,
          );
        }
        if (ids?.startsWith("in.(")) {
          const wanted = ids
            .slice(4, -1)
            .split(",")
            .map((id) => id.replace(/^"|"$/g, ""));
          return json(newestFirst.filter((row) => wanted.includes(String(row.client_request_id))));
        }
        return json(newestFirst.slice(0, 1));
      }
      if (url.pathname === "/rest/v1/profiles") return json(wantsObject ? PROFILE : [PROFILE]);
      if (url.pathname === "/rest/v1/user_entitlements") {
        return json(wantsObject ? ENTITLEMENT : [ENTITLEMENT]);
      }
      return json(wantsObject ? null : []);
    }
    return json({ message: "not found" }, 404);
  });

  // A fixed forecast, so Create my look is ready at once.
  await page.route("https://api.open-meteo.com/**", (route) =>
    route.fulfill({
      status: 200,
      headers: CORS,
      contentType: "application/json",
      body: JSON.stringify({ current: { temperature_2m: 24, weather_code: 0, wind_speed_10m: 5 } }),
    }),
  );

  // The look's server function: recorded and held open. Every other server
  // function goes through to the dev server untouched.
  await page.route("**/_serverFn/**", async (route) => {
    const request = route.request();
    const body = request.postData() ?? "";
    if (request.method() !== "POST" || !body.includes("bodyType")) return route.continue();
    state.lookPosts.push({ id: UUID.exec(body)?.[0] ?? null });
    if (state.failNextLook) {
      // A real answer (in production, e.g. 429 "still finishing your last
      // request"): written by the app server, so it carries Start's
      // `x-tss-serialized` header and the client treats it as Mila's refusal.
      state.failNextLook = false;
      return route.fulfill({
        status: 500,
        headers: { "x-tss-serialized": "true" },
        contentType: "application/json",
        body: "null",
      });
    }
    if (state.gatewayNextLook) {
      // A gateway in front of the app answered instead: not Mila's answer.
      state.gatewayNextLook = false;
      return route.fulfill({
        status: 502,
        contentType: "text/html",
        body: "<html><body><h1>502 Bad Gateway</h1></body></html>",
      });
    }
    if (state.dropNextLook) {
      state.dropNextLook = false;
      return route.abort("connectionreset");
    }
    state.held.push(route);
  });

  return {
    state,
    /** The server started a look: its row is running. */
    runLook(clientRequestId: string, jobId = "33333333-3333-4333-8333-333333333333") {
      const now = Date.now();
      state.rows.push({
        id: jobId,
        user_id: USER_ID,
        kind: "look",
        client_request_id: clientRequestId,
        status: "running",
        credit_state: "charged",
        result: null,
        image_path: null,
        error_code: null,
        input: {},
        deadline_at: new Date(now + 300_000).toISOString(),
        created_at: new Date(now - 2_000).toISOString(),
        completed_at: null,
      });
    },
    /** The server finished and stored her look. */
    finishLook() {
      const row = state.rows.find((r) => r.kind === "look" && r.status === "running");
      if (!row) throw new Error("no running look to finish");
      Object.assign(row, {
        status: "succeeded",
        result: LOOK,
        completed_at: new Date().toISOString(),
      });
    },
    /** A finished look row, created `ageMs` ago (her own, or one from her phone). */
    addFinishedLook(row: {
      clientRequestId: string;
      jobId: string;
      look: typeof LOOK;
      ageMs: number;
    }) {
      const now = Date.now();
      state.rows.push({
        id: row.jobId,
        user_id: USER_ID,
        kind: "look",
        client_request_id: row.clientRequestId,
        status: "succeeded",
        credit_state: "charged",
        result: row.look,
        image_path: null,
        error_code: null,
        input: {},
        deadline_at: new Date(now - row.ageMs + 300_000).toISOString(),
        created_at: new Date(now - row.ageMs).toISOString(),
        completed_at: new Date(now - row.ageMs + 1_000).toISOString(),
      });
    },
    async release() {
      for (const route of state.held.splice(0)) await route.abort("aborted").catch(() => {});
    },
  };
}

async function seedSession(page: Page) {
  const session = makeSession(3600);
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

async function openDashboard(page: Page) {
  await page.goto("/dashboard");
  const create = page.getByRole("button", { name: /Create my look/ });
  await expect(create).toBeEnabled({ timeout: 90_000 });
  return create;
}

/** The waiting copy that only shows while jobs are live (the result is kept for her). */
const canLeave = (page: Page) => page.locator("p", { hasText: /you can leave this page/ });

test.describe("a look being composed is never lost (R7)", () => {
  test.setTimeout(180_000);

  test("leaving mid-run and coming back shows it still composing, with a single POST", async ({
    page,
  }) => {
    const backend = await mockBackend(page, "live");
    await seedSession(page);
    const create = await openDashboard(page);

    await create.click();
    await expect.poll(() => backend.state.lookPosts.length).toBe(1);
    const id = backend.state.lookPosts[0].id;
    expect(id).toMatch(UUID);
    backend.runLook(id as string);
    await expect(canLeave(page)).toBeVisible();

    // Leave: a route change inside the app.
    await page.locator('a[href="/history"]').first().click();
    await page.waitForURL((url) => url.pathname === "/history");
    await expect(canLeave(page)).toHaveCount(0);

    // Another tab comes to the front for a while, then hers again.
    const other = await page.context().newPage();
    await other.bringToFront();
    await other.close();
    await page.bringToFront();

    // Come back: still composing, nothing sent again.
    await page.locator('a[href="/dashboard"]').first().click();
    await page.waitForURL((url) => url.pathname === "/dashboard");
    await expect(canLeave(page)).toBeVisible();
    await expect(page.getByRole("button", { name: /Composing/ })).toBeDisabled();
    await page.waitForTimeout(2_000);
    expect(backend.state.lookPosts).toHaveLength(1);
    await backend.release();
  });

  test("a reload mid-run recovers the finished look from its job row", async ({ page }) => {
    const backend = await mockBackend(page, "live");
    await seedSession(page);
    const create = await openDashboard(page);

    await create.click();
    await expect.poll(() => backend.state.lookPosts.length).toBe(1);
    backend.runLook(backend.state.lookPosts[0].id as string);
    await expect(canLeave(page)).toBeVisible();

    // Reload while the server is still composing: the request is gone with
    // the page, the job row is not.
    await page.reload();
    await expect(canLeave(page)).toBeVisible({ timeout: 90_000 });

    // The server finishes and stores the look.
    backend.finishLook();
    await expect(page.getByText(LOOK.outfit.headline).first()).toBeVisible({ timeout: 20_000 });
    await expect(canLeave(page)).toHaveCount(0);
    // Recovered from the row: no second request, so no second charge.
    expect(backend.state.lookPosts).toHaveLength(1);
    await backend.release();
  });

  test("her recent look comes back on a fresh visit, and a look started elsewhere never covers it", async ({
    page,
  }) => {
    const backend = await mockBackend(page, "live");
    // A look she made earlier today on another device: finished and stored.
    backend.runLook("44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555");
    backend.finishLook();
    await seedSession(page);
    await openDashboard(page);
    await expect(page.getByText(LOOK.outfit.headline).first()).toBeVisible({ timeout: 20_000 });

    // Another look starts on her phone meanwhile; she comes back to this tab.
    backend.runLook("66666666-6666-4666-8666-666666666666", "77777777-7777-4777-8777-777777777777");
    const reads = backend.state.jobsReads;
    // TanStack Query's focus manager listens for visibilitychange on window.
    // src: https://tanstack.com/query/v5/docs/reference/focusManager · 5.101.2
    await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(() => backend.state.jobsReads).toBeGreaterThan(reads);
    await page.waitForTimeout(1_000);

    // The look she is looking at stays; nothing here claims to be composing.
    await expect(page.getByText(LOOK.outfit.headline).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Composing/ })).toHaveCount(0);
    expect(backend.state.lookPosts).toHaveLength(0);
  });

  test("a double press sends one POST, carrying one request id", async ({ page }) => {
    const backend = await mockBackend(page, "live");
    await seedSession(page);
    const create = await openDashboard(page);

    await create.dblclick();
    await page.waitForTimeout(2_000);
    expect(backend.state.lookPosts).toHaveLength(1);
    expect(backend.state.lookPosts[0].id).toMatch(UUID);
    await backend.release();
  });

  test("pressing again after a dropped connection resends the SAME request id (one charge)", async ({
    page,
  }) => {
    const backend = await mockBackend(page, "live");
    await seedSession(page);
    const create = await openDashboard(page);

    backend.state.dropNextLook = true;
    await create.click();
    await expect.poll(() => backend.state.lookPosts.length).toBe(1);
    await expect(create).toBeEnabled({ timeout: 20_000 });

    await create.click();
    await expect.poll(() => backend.state.lookPosts.length).toBe(2);
    const [first, second] = backend.state.lookPosts;
    expect(first.id).toMatch(UUID);
    expect(second.id).toBe(first.id);
    await backend.release();
  });

  test("with the migration not applied, the dashboard behaves as it did before", async ({
    page,
  }) => {
    const backend = await mockBackend(page, "missing");
    await seedSession(page);
    const create = await openDashboard(page);

    await create.click();
    await expect.poll(() => backend.state.lookPosts.length).toBe(1);
    // Still the composing spinner, but no promise she can leave: nothing would keep it.
    await expect(page.getByRole("button", { name: /Composing/ })).toBeDisabled();
    await expect(page.getByRole("status").filter({ hasText: /about 2 minutes/ })).toBeVisible();
    await expect(canLeave(page)).toHaveCount(0);

    // No 3 s polling of a table that is not there.
    const reads = backend.state.jobsReads;
    await page.waitForTimeout(7_000);
    expect(backend.state.jobsReads).toBe(reads);

    // A reload shows the plain empty dashboard, as before: no crash, no raw error.
    await page.reload();
    await expect(create).toBeEnabled({ timeout: 90_000 });
    await expect(page.getByText("Set the mood. Mila will compose the rest.")).toBeVisible();
    await expect(page.getByText(/PGRST205|schema cache|generation_jobs/)).toHaveCount(0);
    await backend.release();
  });

  test("with the migration not applied, the missing table is asked about once, not on every mount or focus (M1)", async ({
    page,
  }) => {
    const backend = await mockBackend(page, "missing");
    await seedSession(page);
    await openDashboard(page);
    await page.waitForTimeout(1_500);
    // One read finds the table missing; the other kinds are never asked.
    expect(backend.state.jobsReads).toBe(1);

    // She comes back to the tab three times, then leaves the page and returns.
    for (let i = 0; i < 3; i += 1) {
      await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
      await page.waitForTimeout(300);
    }
    await page.locator('a[href="/history"]').first().click();
    await page.waitForURL((url) => url.pathname === "/history");
    await page.locator('a[href="/dashboard"]').first().click();
    await page.waitForURL((url) => url.pathname === "/dashboard");
    await page.waitForTimeout(1_500);
    expect(backend.state.jobsReads).toBe(1);
  });
});

test.describe("a paid look shown as composing never vanishes (I1)", () => {
  test.setTimeout(180_000);

  test("a lost answer, then a changed press: her first look is attached to, finishes and shows (no second POST)", async ({
    page,
  }) => {
    const backend = await mockBackend(page, "live");
    await seedSession(page);
    const create = await openDashboard(page);

    // Press 1: the answer is lost before her row is visible.
    backend.state.dropNextLook = true;
    await create.click();
    await expect.poll(() => backend.state.lookPosts.length).toBe(1);
    const firstId = backend.state.lookPosts[0].id as string;
    await expect(create).toBeEnabled({ timeout: 20_000 });
    await page.waitForTimeout(2_500);
    // The server did get it: job 1 is running and charged.
    backend.runLook(firstId);

    // She changes her plan and presses again.
    await page.locator("#agenda-input").fill("Client dinner");
    backend.state.failNextLook = true;
    await create.click();

    // Her paid look 1 is shown as composing; nothing new is sent.
    await expect(canLeave(page)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_500);
    expect(backend.state.lookPosts).toHaveLength(1);

    // It finishes: she sees it.
    backend.finishLook();
    await expect(page.getByText(LOOK.outfit.headline).first()).toBeVisible({ timeout: 20_000 });
    await backend.release();
  });

  test("a lost answer, a changed press refused by the server, then her first job appears: it still lands", async ({
    page,
  }) => {
    const backend = await mockBackend(page, "live");
    await seedSession(page);
    const create = await openDashboard(page);

    backend.state.dropNextLook = true;
    await create.click();
    await expect.poll(() => backend.state.lookPosts.length).toBe(1);
    const firstId = backend.state.lookPosts[0].id as string;
    await expect(create).toBeEnabled({ timeout: 20_000 });
    await page.waitForTimeout(2_500);

    // A changed press: her row is not there yet, so it is sent, and refused.
    await page.locator("#agenda-input").fill("Client dinner");
    backend.state.failNextLook = true;
    await create.click();
    await expect.poll(() => backend.state.lookPosts.length).toBe(2);
    expect(backend.state.lookPosts[1].id).not.toBe(firstId);
    await expect(create).toBeEnabled({ timeout: 20_000 });

    // Now job 1's row shows up (it was running all along), then it finishes.
    backend.runLook(firstId);
    await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    await expect(canLeave(page)).toBeVisible({ timeout: 20_000 });
    backend.finishLook();
    await expect(page.getByText(LOOK.outfit.headline).first()).toBeVisible({ timeout: 20_000 });
    await backend.release();
  });

  test("after a reload, Create waits for her last look to be checked", async ({ page }) => {
    const backend = await mockBackend(page, "live");
    await seedSession(page);
    const create = await openDashboard(page);
    // Round 4: Create waits only when a look press of hers is unanswered, so
    // she presses first (held open), then reloads mid-run.
    await create.click();
    await expect.poll(() => backend.state.lookPosts.length).toBe(1);
    backend.state.jobsDelayMs = 4_000;
    await page.reload();
    await expect(page.getByText("Checking your last look…")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("button", { name: /Create my look/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /Create my look/ })).toBeEnabled({
      timeout: 20_000,
    });
    await expect(page.getByText("Checking your last look…")).toHaveCount(0);
    await backend.release();
  });

  test("a fresh visit with nothing unanswered never waits for a check (round 4)", async ({
    page,
  }) => {
    const backend = await mockBackend(page, "live");
    await seedSession(page);
    await openDashboard(page);
    backend.state.jobsDelayMs = 4_000;
    await page.reload();
    await expect(page.getByRole("button", { name: /Create my look/ })).toBeEnabled({
      timeout: 90_000,
    });
    await expect(page.getByText("Checking your last look…")).toHaveCount(0);
  });

  test("a changed press whose check gets no answer in time shows the check, then goes out under her unanswered id (NEW-M1)", async ({
    page,
  }) => {
    const backend = await mockBackend(page, "live");
    await seedSession(page);
    const create = await openDashboard(page);

    // Press 1: the answer is lost and her row never shows.
    backend.state.dropNextLook = true;
    await create.click();
    await expect.poll(() => backend.state.lookPosts.length).toBe(1);
    const firstId = backend.state.lookPosts[0].id as string;
    await expect(create).toBeEnabled({ timeout: 20_000 });

    // From now on her row's reads hang past the check's 8 s limit.
    backend.state.jobsDelayMs = 12_000;
    await page.locator("#agenda-input").fill("Client dinner");
    await create.click();

    // The check is shown on Create while it runs, and nothing is sent yet.
    await expect(page.getByText("Checking your last look…").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Create my look/ })).toBeDisabled();
    expect(backend.state.lookPosts).toHaveLength(1);

    // At its limit the press goes out under her first id: the server attaches
    // to or replays that job, so she is never charged twice.
    await expect.poll(() => backend.state.lookPosts.length, { timeout: 20_000 }).toBe(2);
    expect(backend.state.lookPosts[1].id).toBe(firstId);
    await expect(page.getByRole("button", { name: /Composing/ })).toBeDisabled();
    await backend.release();
  });

  test("offline, a press is refused at once and never sent later on its own (NEW-M1)", async ({
    page,
    context,
  }) => {
    const backend = await mockBackend(page, "live");
    await seedSession(page);
    const create = await openDashboard(page);

    await context.setOffline(true);
    await create.click();
    await expect(page.getByText(/You're offline\. Nothing was sent\./)).toBeVisible();
    await expect(page.getByRole("button", { name: /Composing/ })).toHaveCount(0);

    // Back online: nothing goes out unless she presses again.
    await context.setOffline(false);
    await page.waitForTimeout(3_000);
    expect(backend.state.lookPosts).toHaveLength(0);
    await expect(page.getByRole("button", { name: /Create my look/ })).toBeEnabled();
  });

  test("her own look lands even when a newer look from her phone is the latest row (round 3)", async ({
    page,
  }) => {
    const backend = await mockBackend(page, "live");
    await seedSession(page);
    const create = await openDashboard(page);

    // Press 1: the answer is lost.
    backend.state.dropNextLook = true;
    await create.click();
    await expect.poll(() => backend.state.lookPosts.length).toBe(1);
    const firstId = backend.state.lookPosts[0].id as string;
    await expect(create).toBeEnabled({ timeout: 20_000 });

    // The server did get it and finished her look; then her phone made a
    // newer one, so the latest row is not hers.
    backend.addFinishedLook({
      clientRequestId: firstId,
      jobId: "33333333-3333-4333-8333-333333333334",
      look: LOOK,
      ageMs: 4_000,
    });
    backend.addFinishedLook({
      clientRequestId: "88888888-8888-4888-8888-888888888888",
      jobId: "99999999-9999-4999-8999-999999999999",
      look: PHONE_LOOK,
      ageMs: 1_500,
    });

    // She comes back to the tab: her own paid look lands, and the phone's
    // newer look never covers it.
    await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByText(LOOK.outfit.headline).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2_000);
    await expect(page.getByText(LOOK.outfit.headline).first()).toBeVisible();
    await expect(page.getByText(PHONE_LOOK.outfit.headline)).toHaveCount(0);
    // Recovered from her row: nothing was sent again.
    expect(backend.state.lookPosts).toHaveLength(1);
  });

  test("her own-ids read fails while a newer look from her phone exists: the phone's look waits, and hers lands when it succeeds (round 5, N-1)", async ({
    page,
  }) => {
    const backend = await mockBackend(page, "live");
    await seedSession(page);
    const create = await openDashboard(page);

    // Reading her ids fails from the very first read.
    backend.state.failOwnReads = 1_000;
    // Press 1: the answer is lost; the server is still composing it.
    backend.state.dropNextLook = true;
    await create.click();
    await expect.poll(() => backend.state.lookPosts.length).toBe(1);
    const firstId = backend.state.lookPosts[0].id as string;
    await expect(create).toBeEnabled({ timeout: 20_000 });
    backend.runLook(firstId, "33333333-3333-4333-8333-333333333335");

    // Her phone made a newer look.
    backend.addFinishedLook({
      clientRequestId: "88888888-8888-4888-8888-888888888888",
      jobId: "99999999-9999-4999-8999-999999999999",
      look: PHONE_LOOK,
      ageMs: 500,
    });
    await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(4_000);
    // The phone's look is held back: hers may still land.
    await expect(page.getByText(PHONE_LOOK.outfit.headline)).toHaveCount(0);

    // Her job succeeds and her ids can be read again: her paid look lands.
    backend.finishLook();
    backend.state.failOwnReads = 0;
    await expect(page.getByText(LOOK.outfit.headline).first()).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText(PHONE_LOOK.outfit.headline)).toHaveCount(0);
    expect(backend.state.lookPosts).toHaveLength(1);
  });

  test("a gateway page instead of an answer keeps the id, says so calmly, and the next press resends the SAME id (round 5, m-3)", async ({
    page,
  }) => {
    const backend = await mockBackend(page, "live");
    await seedSession(page);
    const create = await openDashboard(page);

    backend.state.gatewayNextLook = true;
    await create.click();
    await expect.poll(() => backend.state.lookPosts.length).toBe(1);
    await expect(create).toBeEnabled({ timeout: 20_000 });
    // Calm copy, never the gateway's page.
    await expect(page.getByText(/you won't be charged twice/).first()).toBeVisible();
    await expect(page.getByText(/Bad Gateway|<html>/)).toHaveCount(0);

    // The same press again goes out under the same id: one charge at most.
    await create.click();
    await expect.poll(() => backend.state.lookPosts.length).toBe(2);
    expect(backend.state.lookPosts[1].id).toBe(backend.state.lookPosts[0].id);
    await backend.release();
  });

  test("a recent look she already saved does not come back (M2)", async ({ page }) => {
    const backend = await mockBackend(page, "live");
    backend.runLook("44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555");
    backend.finishLook();
    backend.state.savedHeadlines.push(LOOK.outfit.headline);
    await seedSession(page);
    await openDashboard(page);
    await page.waitForTimeout(2_000);
    await expect(page.getByText("Set the mood. Mila will compose the rest.")).toBeVisible();
    await expect(page.getByText(LOOK.outfit.headline)).toHaveCount(0);
  });
});
