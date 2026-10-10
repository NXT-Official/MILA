import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

// src: bun test mock.module, same restore pattern as posthog-client.test.ts
const realServer = await import("@tanstack/react-start/server");
let requestHost = "";

beforeAll(() => {
  mock.module("@tanstack/react-start/server", () => ({
    ...realServer,
    getRequestUrl: () => new URL(`https://${requestHost}/anything?x=1`),
  }));
});
afterAll(() => {
  mock.module("@tanstack/react-start/server", () => realServer);
});

const ENV_KEYS = ["SITE_URL", "SITE_INDEXING", "VERCEL_PROJECT_PRODUCTION_URL"] as const;

async function read(host: string, env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  const saved = ENV_KEYS.map((key) => [key, process.env[key]] as const);
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  requestHost = host;
  try {
    const { readSiteContext } = await import("./site-context.server");
    return readSiteContext();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("readSiteContext", () => {
  test("the live host is indexable (compares the host, not the origin)", async () => {
    expect(
      await read("milafashion.site", {
        VERCEL_PROJECT_PRODUCTION_URL: "milafashion.site",
      }),
    ).toEqual({ origin: "https://milafashion.site", indexable: true });
  });

  test("the nicoleDev host is not indexable", async () => {
    expect(
      await read("mila-nicoledev.vercel.app", {
        VERCEL_PROJECT_PRODUCTION_URL: "mila-nicoledev.vercel.app",
      }),
    ).toEqual({ origin: "https://milafashion.site", indexable: false });
  });

  test("the kill switch is read from the environment", async () => {
    expect((await read("milafashion.site", { SITE_INDEXING: "off" })).indexable).toBe(false);
  });
});
