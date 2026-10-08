import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * P2b W4 in a real browser: a Concierge reply she paid for survives leaving
 * the page and a reload, a retry never drops her photo or charges twice, and
 * Send waits while her photo is prepared. Every Supabase call is answered by
 * `page.route`, the chat's server function is held open or failed on purpose
 * (no AI keys, no network), and her concierge job row
 * (`/rest/v1/generation_jobs`) is scripted.
 *
 * Run it against a dev server whose Supabase URL is the one below, e.g.
 *   VITE_SUPABASE_URL=http://127.0.0.1:54931 SUPABASE_URL=http://127.0.0.1:54931 \
 *   VITE_SUPABASE_PUBLISHABLE_KEY=test SUPABASE_PUBLISHABLE_KEY=test bun run dev
 * then `E2E_BASE_URL=https://localhost:<port> bunx playwright test tests/e2e/concierge-recovery.spec.ts`.
 * Nothing needs to listen on the Supabase URL: the browser's requests never
 * leave Playwright.
 */
const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54931";
// supabase-js default storage key: `sb-<first host label>-auth-token`.
// src: node_modules/@supabase/supabase-js/src/SupabaseClient.ts `defaultStorageKey` · 2.110.0
const STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MESSAGE = "What goes with olive trousers?";
const REPLY = "Cream knit and tan loafers keep olive warm and easy.";
const LEAVE = "You can leave this page. Mila's reply will be here.";
// A 1×1 PNG: decodes in every browser, so photo prep finishes.
const PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

if (process.env.E2E_BASE_URL) test.use({ baseURL: process.env.E2E_BASE_URL });

// The default `bun run test:e2e` starts a dev server on the real `.env`, where
// these mocks cannot answer: skip unless pointed at a fake-Supabase dev server.
test.skip(
  !process.env.E2E_BASE_URL,
  "needs a dev server on the fake Supabase URL and E2E_BASE_URL (see the header)",
);

// The dev server's HMR socket (`wss://host/?token=…`) reloads the page whenever
// any file in the shared tree changes. A silent mock keeps it open and quiet.
// src: https://playwright.dev/docs/api/class-websocketroute · @playwright/test 1.63
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(/[?&]token=/, () => {});
});

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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD",
};

type SerovalNode = { t?: unknown; s?: unknown; p?: { k?: unknown; v?: unknown } };

/**
 * One field of the chat request. TanStack Start sends seroval JSON: objects as
 * `{ p: { k: [keys], v: [values] } }`, strings as `{ t: 1, s }`, null as `{ t: 2 }`.
 */
function requestField(body: string, key: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const walk = (node: unknown): string | null | undefined => {
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (!node || typeof node !== "object") return undefined;
    const { p } = node as SerovalNode;
    if (p && Array.isArray(p.k) && Array.isArray(p.v)) {
      const at = p.k.indexOf(key);
      if (at >= 0) {
        const value = p.v[at] as SerovalNode | undefined;
        return value && value.t === 1 && typeof value.s === "string" ? value.s : null;
      }
    }
    for (const value of Object.values(node)) {
      const found = walk(value);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(parsed) ?? null;
}

type JobRow = Record<string, unknown>;
type ChatPost = {
  id: string | null;
  imageUrl: string | null;
  conversationId: string | null;
  saveTurn: boolean;
};

async function mockBackend(page: Page, jobs: "live" | "missing") {
  const state = {
    jobs,
    rows: [] as JobRow[],
    jobsReads: 0,
    /** Every chat request the browser sent. */
    chatPosts: [] as ChatPost[],
    /** Chat requests held open (never answered): Mila is "still composing". */
    held: [] as Route[],
    /** The next chat request gets a gateway page (a lost answer, not Mila's refusal). */
    gatewayNextChat: false,
    /** Photos uploaded to storage (object paths). */
    uploads: [] as string[],
    conversations: [] as Array<{ id: string; title: string; updated_at: string }>,
    messages: {} as Record<string, Array<Record<string, unknown>>>,
    /** Rows the browser itself inserted into concierge tables. */
    clientInserts: [] as string[],
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
    if (url.pathname === "/auth/v1/token") return json(makeSession(3600));
    if (url.pathname === "/auth/v1/user") return json(makeSession(3600).user);
    if (url.pathname === "/auth/v1/logout") return route.fulfill({ status: 204, headers: CORS });
    if (url.pathname.startsWith("/storage/v1/object/public/")) {
      return route.fulfill({ status: 200, headers: CORS, contentType: "image/png", body: PHOTO });
    }
    if (url.pathname.startsWith("/storage/v1/object/outfits/")) {
      const path = url.pathname.slice("/storage/v1/object/outfits/".length);
      state.uploads.push(path);
      return json({ Key: `outfits/${path}`, Id: crypto.randomUUID() });
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const wantsObject = (request.headers()["accept"] ?? "").includes("vnd.pgrst.object");
      // Our JWTs start with the base64url of `{"alg"`: "eyJ". RLS shows an
      // anonymous caller nothing.
      if (!(request.headers()["authorization"] ?? "").startsWith("Bearer eyJ")) {
        return json(wantsObject ? null : []);
      }
      if (url.pathname === "/rest/v1/generation_jobs") {
        state.jobsReads += 1;
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
        return json(newestFirst.slice(0, 1));
      }
      if (url.pathname === "/rest/v1/concierge_conversations") {
        if (request.method() === "POST") {
          state.clientInserts.push("conversation");
          return json(wantsObject ? { id: CONVERSATION_ID } : [{ id: CONVERSATION_ID }], 201);
        }
        if (request.method() === "PATCH") return route.fulfill({ status: 204, headers: CORS });
        return json(state.conversations);
      }
      if (url.pathname === "/rest/v1/concierge_messages") {
        if (request.method() === "POST") {
          state.clientInserts.push("messages");
          return route.fulfill({ status: 201, headers: CORS });
        }
        const id = (url.searchParams.get("conversation_id") ?? "").replace(/^eq\./, "");
        return json(state.messages[id] ?? []);
      }
      if (url.pathname === "/rest/v1/profiles") return json(wantsObject ? PROFILE : [PROFILE]);
      if (url.pathname === "/rest/v1/user_entitlements") {
        return json(wantsObject ? ENTITLEMENT : [ENTITLEMENT]);
      }
      return json(wantsObject ? null : []);
    }
    return json({ message: "not found" }, 404);
  });

  // The chat's server function: recorded, then held open or failed. Every
  // other server function goes through to the dev server untouched.
  await page.route("**/_serverFn/**", async (route) => {
    const request = route.request();
    const body = request.postData() ?? "";
    if (request.method() !== "POST" || !body.includes('"history"')) return route.continue();
    state.chatPosts.push({
      id: requestField(body, "clientRequestId"),
      imageUrl: requestField(body, "imageUrl"),
      conversationId: requestField(body, "conversationId"),
      saveTurn: body.includes('"saveTurn"'),
    });
    if (state.gatewayNextChat) {
      state.gatewayNextChat = false;
      return route.fulfill({ status: 502, contentType: "text/html", body: "<html>502</html>" });
    }
    state.held.push(route);
  });

  return {
    state,
    /** The server started her turn: its row is running. */
    runTurn(post: ChatPost, jobId = "33333333-3333-4333-8333-333333333333") {
      const now = Date.now();
      state.rows.push({
        id: jobId,
        user_id: USER_ID,
        kind: "concierge",
        client_request_id: post.id,
        status: "running",
        credit_state: "charged",
        result: null,
        image_path: null,
        error_code: null,
        input: {
          message: MESSAGE,
          lookId: null,
          imageUrl: post.imageUrl,
          conversationId: post.conversationId,
          saveTurn: true,
        },
        deadline_at: new Date(now + 300_000).toISOString(),
        created_at: new Date(now - 2_000).toISOString(),
        completed_at: null,
      });
    },
    /** The server answered and saved the turn into a new conversation. */
    finishTurn() {
      const row = state.rows.find((r) => r.kind === "concierge" && r.status === "running");
      if (!row) throw new Error("no running turn to finish");
      const now = Date.now();
      state.conversations.push({
        id: CONVERSATION_ID,
        title: MESSAGE,
        updated_at: new Date(now).toISOString(),
      });
      state.messages[CONVERSATION_ID] = [
        {
          role: "user",
          content: MESSAGE,
          image_url: null,
          created_at: new Date(now).toISOString(),
        },
        {
          role: "assistant",
          content: REPLY,
          image_url: null,
          created_at: new Date(now + 1).toISOString(),
        },
      ];
      Object.assign(row, {
        status: "succeeded",
        result: { reply: REPLY, conversationId: CONVERSATION_ID, saved: true },
        completed_at: new Date(now).toISOString(),
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

async function openConcierge(page: Page) {
  await page.goto("/concierge");
  const box = page.getByRole("textbox", { name: "Message Mila" });
  await expect(box).toBeEnabled({ timeout: 90_000 });
  return box;
}

const photoInput = (page: Page) => page.locator('form input[type="file"]');
const sendButton = (page: Page) => page.getByRole("button", { name: "Send message" });

test.describe("a Concierge reply she paid for is never lost (P2b W4)", () => {
  test.setTimeout(180_000);

  test("leaving mid-reply and coming back shows her turn still composing, then the reply, with one POST", async ({
    page,
  }) => {
    const backend = await mockBackend(page, "live");
    await seedSession(page);
    const box = await openConcierge(page);

    await box.fill(MESSAGE);
    await box.press("Enter");
    await expect.poll(() => backend.state.chatPosts.length).toBe(1);
    const post = backend.state.chatPosts[0];
    expect(post.id).toMatch(UUID);
    expect(post.saveTurn).toBe(true);
    backend.runTurn(post);
    await expect(page.getByText(LEAVE)).toBeVisible({ timeout: 20_000 });

    // Leave for History, then come back through the Concierge button.
    await page.locator('a[href="/history"]').first().click();
    await page.waitForURL((url) => url.pathname === "/history");
    await page.getByRole("button", { name: "Open Mila's Styling Studio" }).first().click();
    await page.waitForURL((url) => url.pathname === "/concierge");

    // Her turn is still there, composing; nothing was sent again.
    await expect(page.getByText(MESSAGE)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(LEAVE)).toBeVisible();
    await expect(sendButton(page)).toBeDisabled();

    // The server finishes and saves the turn: the reply lands from its conversation.
    backend.finishTurn();
    await expect(page.getByText(REPLY)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(LEAVE)).toHaveCount(0);
    expect(backend.state.chatPosts).toHaveLength(1);
    // Saved by the server: the browser wrote nothing itself.
    expect(backend.state.clientInserts).toEqual([]);
    await backend.release();
  });

  test("a reload mid-reply recovers the reply from its conversation", async ({ page }) => {
    const backend = await mockBackend(page, "live");
    await seedSession(page);
    const box = await openConcierge(page);

    await box.fill(MESSAGE);
    await box.press("Enter");
    await expect.poll(() => backend.state.chatPosts.length).toBe(1);
    backend.runTurn(backend.state.chatPosts[0]);
    await expect(page.getByText(LEAVE)).toBeVisible({ timeout: 20_000 });

    await page.reload();
    await expect(page.getByText(MESSAGE)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(LEAVE)).toBeVisible();

    backend.finishTurn();
    await expect(page.getByText(REPLY)).toBeVisible({ timeout: 20_000 });
    // The chat is now that conversation (listed in Recents).
    await expect(page.getByRole("button", { name: MESSAGE }).first()).toBeVisible();
    expect(backend.state.chatPosts).toHaveLength(1);
    await backend.release();
  });

  test("a retry after a lost answer keeps her photo and her request id (one upload, one charge)", async ({
    page,
  }) => {
    const backend = await mockBackend(page, "live");
    await seedSession(page);
    const box = await openConcierge(page);

    await photoInput(page).setInputFiles({
      name: "look.png",
      mimeType: "image/png",
      buffer: PHOTO,
    });
    await expect(page.getByRole("button", { name: "Remove attached image" })).toBeVisible();
    backend.state.gatewayNextChat = true;
    await box.fill(MESSAGE);
    await box.press("Enter");
    await expect.poll(() => backend.state.chatPosts.length).toBe(1);
    await expect(page.getByText("Not sent.")).toBeVisible({ timeout: 20_000 });
    // A gateway page is never shown to her as an error.
    await expect(page.getByText("<html>502</html>")).toHaveCount(0);

    await page.getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => backend.state.chatPosts.length).toBe(2);
    const [first, second] = backend.state.chatPosts;
    expect(first.imageUrl).toContain("/outfits/");
    expect(second.imageUrl).toBe(first.imageUrl);
    expect(first.id).toMatch(UUID);
    expect(second.id).toBe(first.id);
    expect(backend.state.uploads).toHaveLength(1);
    await backend.release();
  });

  test("Send waits while her photo is being prepared, so the photo is never dropped", async ({
    page,
  }) => {
    // Photo prep decodes with createImageBitmap: slow it down so the wait is visible.
    await page.addInitScript(() => {
      const original = window.createImageBitmap.bind(window);
      window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) =>
        new Promise((resolve) => setTimeout(resolve, 2_500)).then(() =>
          original(...args),
        )) as typeof createImageBitmap;
    });
    const backend = await mockBackend(page, "live");
    await seedSession(page);
    const box = await openConcierge(page);

    await box.fill(MESSAGE);
    await photoInput(page).setInputFiles({
      name: "look.png",
      mimeType: "image/png",
      buffer: PHOTO,
    });
    await expect(
      page.getByRole("status").filter({ hasText: "Preparing your photo…" }),
    ).toBeVisible();
    await expect(sendButton(page)).toBeDisabled();
    await box.press("Enter");
    await page.waitForTimeout(500);
    expect(backend.state.chatPosts).toHaveLength(0);

    await expect(page.getByRole("button", { name: "Remove attached image" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(sendButton(page)).toBeEnabled();
    await box.press("Enter");
    await expect.poll(() => backend.state.chatPosts.length).toBe(1);
    expect(backend.state.chatPosts[0].imageUrl).toContain("/outfits/");
    await backend.release();
  });

  test("a double send sends one POST", async ({ page }) => {
    const backend = await mockBackend(page, "live");
    await seedSession(page);
    const box = await openConcierge(page);

    await box.fill(MESSAGE);
    await sendButton(page).dblclick();
    await page.waitForTimeout(2_000);
    expect(backend.state.chatPosts).toHaveLength(1);
    await backend.release();
  });

  test("with the migration not applied, the chat behaves as it did before", async ({ page }) => {
    const backend = await mockBackend(page, "missing");
    await seedSession(page);
    const box = await openConcierge(page);

    await box.fill(MESSAGE);
    await box.press("Enter");
    await expect.poll(() => backend.state.chatPosts.length).toBe(1);
    // Still composing, but no promise she can leave: nothing would keep it.
    await expect(page.getByText("Mila is composing…")).toBeVisible();
    await expect(page.getByText(LEAVE)).toHaveCount(0);

    // No polling of a table that is not there.
    const reads = backend.state.jobsReads;
    await page.waitForTimeout(7_000);
    expect(backend.state.jobsReads).toBe(reads);

    // A reload shows the plain chat: no crash, no raw error.
    await backend.release();
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Message Mila" })).toBeEnabled({
      timeout: 90_000,
    });
    await expect(page.getByText("How can I help you style today?")).toBeVisible();
    await expect(page.getByText(/PGRST205|schema cache|generation_jobs/)).toHaveCount(0);
  });
});
