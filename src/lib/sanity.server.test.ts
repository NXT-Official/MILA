import { afterAll, describe, expect, test } from "bun:test";

/** A stand-in Sanity API that is down: every request gets a 503, and is counted. */
const hits: number[] = [];
const sanityDown = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch() {
    hits.push(performance.now());
    return Response.json({ error: "down" }, { status: 503 });
  },
});
// The module reads its project from the environment when first imported; any
// stand-in set for that is taken back, so later test files see the real env.
const ENV_BEFORE = {
  SANITY_PROJECT_ID: process.env.SANITY_PROJECT_ID,
  SANITY_DATASET: process.env.SANITY_DATASET,
};
afterAll(() => {
  sanityDown.stop(true);
  for (const [name, value] of Object.entries(ENV_BEFORE)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

/** The app's client, sending its requests to the stand-in instead of Sanity. */
async function clientAgainstSanityDown() {
  process.env.SANITY_PROJECT_ID ||= "testproject";
  process.env.SANITY_DATASET ||= "production";
  const { sanity } = await import("./sanity.server");
  return sanity.withConfig({
    apiHost: `http://127.0.0.1:${sanityDown.port}`,
    useProjectHostname: false,
    useCdn: false,
  });
}

describe("the Sanity client", () => {
  // The landing loader backs off for 30s after a failed read; the client must
  // not run up its own string of retries inside each read first.
  test("tries a failing read at most twice", async () => {
    const client = await clientAgainstSanityDown();
    hits.length = 0;
    await expect(client.fetch("*[0]")).rejects.toMatchObject({ statusCode: 503 });
    expect(hits).toHaveLength(2);
  });
});
