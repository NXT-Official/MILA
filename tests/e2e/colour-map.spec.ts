import { test, expect, type Page } from "@playwright/test";

/**
 * Her colour map in a real browser (Wave D, D-W7): a composed look shows
 * "Your color map" above Shop This Look, and each shop card carries a chip
 * naming the colour to wear it in. Every Supabase call is answered by
 * `page.route`; the look arrives the way a composed look comes back to her
 * dashboard after a reload, as the finished result of her look's generation
 * job (`/rest/v1/generation_jobs`), so no AI key and no network are needed.
 *
 * Run it against a dev server whose Supabase URL is the one below, e.g.
 *   VITE_SUPABASE_URL=http://127.0.0.1:54931 SUPABASE_URL=http://127.0.0.1:54931 \
 *   VITE_SUPABASE_PUBLISHABLE_KEY=test SUPABASE_PUBLISHABLE_KEY=test bun run dev
 * then `E2E_BASE_URL=https://localhost:<port> bunx playwright test tests/e2e/colour-map.spec.ts`.
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

// The dev server's HMR socket (`wss://host/?token=…`) reloads the page whenever
// any file in the shared tree changes. A silent mock keeps it open and quiet.
// src: https://playwright.dev/docs/api/class-websocketroute ("by default, the
// routed WebSocket will not connect to the server") · @playwright/test 1.63
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/[?&]token=/, () => {});
});

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function makeSession() {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;
  return {
    access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER_ID, exp, iat: now, role: "authenticated", aud: "authenticated" })}.sig`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    refresh_token: `rt-${now}`,
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
  color_profile: {
    season: "Autumn",
    primarySwatches: [
      { name: "Olive", hex: "#556B2F" },
      { name: "Camel", hex: "#C19A6B" },
    ],
    secondarySwatches: [{ name: "Charcoal", hex: "#36454F" }],
  },
  beauty_preferences: [],
  suspended: false,
  photo_consent_at: null,
};

const ENTITLEMENT = {
  ai_credits: 3,
  purchased_credits: 0,
  credits_reset_at: new Date().toISOString().slice(0, 10),
};

function pick(id: string, title: string, category: string, wear: Record<string, string> | null) {
  return {
    id,
    title,
    brand_id: "brand-1",
    category,
    price: 120,
    currency: "USD",
    image_url: null,
    affiliate_link: `https://shop.example.com/${id}`,
    verification_status: "verified",
    last_verified_at: "2026-10-01T00:00:00Z",
    rationale: "Suits her coloring. A second sentence the map leaves out.",
    source: "planned",
    wear_colour: wear,
  };
}

// The look her job stored: every piece planned with one of her colours.
const LOOK = {
  outfit: {
    headline: "The Olive Weekend Edit",
    description: "A camel camp shirt over olive wide-leg trousers, finished with charcoal loafers.",
    styling_notes: "Half-tuck the shirt.",
  },
  hair: { style: "Soft waves", execution_tip: "Air dry with a light cream." },
  makeup: null,
  vibe_alignment_score: 8,
  shoppable_picks: [
    pick("aaaaaaaa-0000-4000-8000-000000000001", "Wide Leg Trousers", "Bottoms", {
      name: "Olive",
      hex: "#556B2F",
      role: "base",
    }),
    pick("aaaaaaaa-0000-4000-8000-000000000002", "Silk Camp Shirt", "Tops", {
      name: "Camel",
      hex: "#C19A6B",
      role: "statement",
    }),
    pick("aaaaaaaa-0000-4000-8000-000000000003", "Suede Loafers", "Shoes", {
      name: "Charcoal",
      hex: "#36454F",
      role: "accent",
    }),
  ],
  forecastRetrievedAt: null,
  fallback_gender_direction: null,
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD",
};

// The same look with a fourth piece: the weather backfill coat, in a colour
// whose name is 40 characters with no space (the longest a swatch name can be).
const LONG_NAME = "Midnightinkbluewithsmokygreyundertonesxx";
const NARROW_LOOK = {
  ...LOOK,
  shoppable_picks: [
    ...LOOK.shoppable_picks,
    {
      ...pick("aaaaaaaa-0000-4000-8000-000000000004", "Wool Overcoat", "Outerwear", {
        name: LONG_NAME,
        hex: "#1F2A44",
        role: "base",
      }),
      rationale: "Added for today's temperature: the outer layer this look was missing.",
    },
  ],
};

async function mockBackend(page: Page, look: typeof LOOK = LOOK) {
  const now = Date.now();
  const lookRow = {
    id: "55555555-5555-4555-8555-555555555555",
    user_id: USER_ID,
    kind: "look",
    client_request_id: "44444444-4444-4444-8444-444444444444",
    status: "succeeded",
    credit_state: "charged",
    result: look,
    image_path: null,
    error_code: null,
    input: {},
    deadline_at: new Date(now + 240_000).toISOString(),
    created_at: new Date(now - 60_000).toISOString(),
    completed_at: new Date(now - 30_000).toISOString(),
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
        .catch(() => {});
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (url.pathname === "/auth/v1/token") return json(makeSession());
    if (url.pathname === "/auth/v1/user") return json(makeSession().user);
    if (url.pathname === "/auth/v1/logout") return route.fulfill({ status: 204, headers: CORS });
    if (url.pathname.startsWith("/rest/v1/")) {
      const wantsObject = (request.headers()["accept"] ?? "").includes("vnd.pgrst.object");
      if (!(request.headers()["authorization"] ?? "").startsWith("Bearer eyJ")) {
        return json(wantsObject ? null : []);
      }
      if (url.pathname === "/rest/v1/generation_jobs") {
        const kind = (url.searchParams.get("kind") ?? "").replace(/^eq\./, "");
        return json(kind === "look" ? [lookRow] : []);
      }
      if (url.pathname === "/rest/v1/profiles") return json(wantsObject ? PROFILE : [PROFILE]);
      if (url.pathname === "/rest/v1/user_entitlements") {
        return json(wantsObject ? ENTITLEMENT : [ENTITLEMENT]);
      }
      return json(wantsObject ? null : []);
    }
    return json({ message: "not found" }, 404);
  });

  // A fixed forecast, so the dashboard settles at once.
  await page.route("https://api.open-meteo.com/**", (route) =>
    route.fulfill({
      status: 200,
      headers: CORS,
      contentType: "application/json",
      body: JSON.stringify({ current: { temperature_2m: 24, weather_code: 0, wind_speed_10m: 5 } }),
    }),
  );
}

async function seedSession(page: Page) {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("e2e-seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("e2e-seeded", "1");
      }
    },
    [STORAGE_KEY, JSON.stringify(makeSession())] as const,
  );
}

test("a composed look shows Your color map and a chip on each card", async ({ page }) => {
  test.setTimeout(120_000);
  await mockBackend(page);
  await seedSession(page);
  await page.goto("/dashboard");

  await expect(page.getByText(LOOK.outfit.headline).first()).toBeVisible({ timeout: 90_000 });

  const map = page.getByRole("list", { name: "Your color map" });
  await expect(map).toBeVisible();
  await expect(map.getByRole("listitem")).toHaveCount(3);
  // Head to toe: the shirt, then the trousers, then the loafers.
  await expect(map.getByRole("listitem").nth(0)).toContainText("Camel");
  await expect(map.getByRole("listitem").nth(0)).toContainText("Statement · Near your face");
  await expect(map.getByRole("listitem").nth(1)).toContainText("Olive");
  await expect(map.getByRole("listitem").nth(1)).toContainText("Base · Bottoms and outer layers");
  await expect(map.getByRole("listitem").nth(2)).toContainText("Charcoal");
  await expect(map.getByRole("listitem").nth(2)).toContainText("Accent · Shoes, bag and jewelry");
  await expect(map).toContainText("Suits her coloring.");
  await expect(map).not.toContainText("A second sentence");

  // Every card names its colour beside its garment badge.
  for (const { id, wear } of [
    { id: "aaaaaaaa-0000-4000-8000-000000000001", wear: "Olive" },
    { id: "aaaaaaaa-0000-4000-8000-000000000002", wear: "Camel" },
    { id: "aaaaaaaa-0000-4000-8000-000000000003", wear: "Charcoal" },
  ]) {
    await expect(page.locator(`#shop-${id}`)).toContainText(wear);
  }

  // "See this piece" brings that piece's card into view and focuses its link,
  // without a hash in the URL (which would re-run the route).
  const urlBefore = page.url();
  await map.getByRole("link", { name: /See this piece: Silk Camp Shirt/ }).click();
  const shirtCard = page.locator("#shop-aaaaaaaa-0000-4000-8000-000000000002");
  await expect(shirtCard).toBeInViewport();
  await expect(shirtCard.locator("a[href]").first()).toBeFocused();
  expect(page.url()).toBe(urlBefore);

  // No visible dash anywhere in the map.
  expect(await map.innerText()).not.toMatch(/[–—]/);
});

for (const width of [320, 375]) {
  test(`at ${width}px the color map never scrolls sideways`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 800 });
    await mockBackend(page, NARROW_LOOK);
    await seedSession(page);
    await page.goto("/dashboard");
    await expect(page.getByText(LOOK.outfit.headline).first()).toBeVisible({ timeout: 90_000 });

    const map = page.getByRole("list", { name: "Your color map" });
    await expect(map.getByRole("listitem")).toHaveCount(4);
    await expect(map).toContainText(LONG_NAME);
    // The backfill coat's reason reads without a dash.
    await expect(map).toContainText("Added for today's temperature: the outer layer");
    expect(await map.innerText()).not.toMatch(/[–—]/);

    // The whole panel (its card, not just the list) fits the screen: nothing
    // inside it is wider than its box, and the box ends inside the viewport.
    const panel = map.locator("xpath=ancestor::section[1]");
    const fit = await panel.evaluate((section) => {
      const box = section.getBoundingClientRect();
      const overflowing = [section, ...section.querySelectorAll("*")]
        .filter((node) => node.scrollWidth > node.clientWidth + 1)
        .filter((node) => getComputedStyle(node).overflowX !== "hidden")
        .map((node) => `${node.tagName.toLowerCase()}.${String(node.className).slice(0, 60)}`);
      return {
        left: box.left,
        right: box.right,
        viewport: document.documentElement.clientWidth,
        overflowing,
      };
    });
    expect(fit.overflowing).toEqual([]);
    expect(fit.left).toBeGreaterThanOrEqual(0);
    expect(fit.right).toBeLessThanOrEqual(fit.viewport);

    // And the panel never makes the page itself scroll sideways.
    const pageScroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(pageScroll.scrollWidth).toBeLessThanOrEqual(pageScroll.clientWidth);
  });
}
