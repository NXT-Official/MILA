import { describe, expect, test } from "bun:test";
import { fetchLandingDocument, reportLandingFailure } from "./landing-content.functions";
import { LANDING_QUERY } from "./landing-content.normalize";

/** Stands in for the Sanity client: records each fetch and answers with `reply`. */
function stubClient(reply: unknown = { howItWorks: {} }) {
  const calls: { query: string; params: unknown; options: { signal: AbortSignal } }[] = [];
  return {
    calls,
    fetch: async (
      query: string,
      params: Record<string, never>,
      options: { signal: AbortSignal },
    ) => {
      calls.push({ query, params, options });
      return reply;
    },
  };
}

describe("fetchLandingDocument", () => {
  test("runs LANDING_QUERY without parameters and returns Sanity's answer", async () => {
    const client = stubClient({ howItWorks: { heading: "From Sanity" } });
    const answer = await fetchLandingDocument(new AbortController().signal, client);
    expect(answer).toEqual({ howItWorks: { heading: "From Sanity" } });
    expect(client.calls.map(({ query, params }) => ({ query, params }))).toEqual([
      { query: LANDING_QUERY, params: {} },
    ]);
  });

  // The loader aborts a read at its deadline; only the signal reaching the
  // client turns that abort into a cancelled request.
  test("hands the loader's abort signal to the Sanity client", async () => {
    const client = stubClient();
    const controller = new AbortController();
    await fetchLandingDocument(controller.signal, client);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].options.signal).toBe(controller.signal);
  });
});

describe("reportLandingFailure", () => {
  test("sends the failure to Sentry's captureServerException", async () => {
    const captured: unknown[] = [];
    const failure = new Error("Sanity is down");
    await reportLandingFailure(failure, async () => ({
      captureServerException: (error: unknown) => {
        captured.push(error);
      },
    }));
    expect(captured).toEqual([failure]);
  });

  test("never rejects, whether Sentry fails to load or to capture", async () => {
    await expect(
      reportLandingFailure(new Error("boom"), () => Promise.reject(new Error("no Sentry"))),
    ).resolves.toBeUndefined();
    await expect(
      reportLandingFailure(new Error("boom"), async () => ({
        captureServerException: () => {
          throw new Error("Sentry transport exploded");
        },
      })),
    ).resolves.toBeUndefined();
  });
});
