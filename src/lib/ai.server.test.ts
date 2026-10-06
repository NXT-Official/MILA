import { afterEach, describe, expect, mock, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiChatCompletion, isAiConfigured } from "./ai.server";

const fakeCaller = {
  supabase: {
    from: () => ({ insert: async () => ({ error: null }) }),
  } as unknown as SupabaseClient,
  userId: "user-1",
};

const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENROUTER_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
});

const tool = {
  function: {
    name: "report_test",
    parameters: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
  },
};

function stubProvider(response: Response) {
  process.env.OPENROUTER_API_KEY = "test-key";
  const fetchMock = mock(async () => response);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe("isAiConfigured", () => {
  test("false when OPENROUTER_API_KEY is unset", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(isAiConfigured()).toBe(false);
  });

  test("true when OPENROUTER_API_KEY is set", () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    expect(isAiConfigured()).toBe(true);
  });
});

describe("OpenRouter chat gateway", () => {
  test("sends structured output request and returns the parsed tool arguments", async () => {
    const fetchMock = stubProvider(
      Response.json({
        choices: [{ message: { content: '{"value":"ok"}' } }],
        usage: { cost: 0.001, prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );

    const result = await aiChatCompletion(
      [
        { role: "system", content: "Follow instructions." },
        {
          role: "user",
          content: [
            { type: "text", text: "Report a value." },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,YQ==" } },
          ],
        },
      ],
      tool,
      fakeCaller,
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(body.model).toBe("deepseek/deepseek-v4.1-flash");
    expect(body.messages[1].content[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,YQ==" },
    });
    expect(body.response_format.json_schema.name).toBe("report_test");
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(result).toEqual({ ok: true, args: { value: "ok" } });
  });

  test("tolerates a fenced JSON reply", async () => {
    stubProvider(
      Response.json({ choices: [{ message: { content: '```json\n{"value":"ok"}\n```' } }] }),
    );
    expect(await aiChatCompletion([], tool, fakeCaller)).toEqual({
      ok: true,
      args: { value: "ok" },
    });
  });

  test("finds the JSON object in a reply wrapped in prose", async () => {
    // Not every provider behind a model honours the structured-output request.
    stubProvider(
      Response.json({
        choices: [{ message: { content: 'Here is the read:\n{"value":"ok"}\nHope that helps.' } }],
      }),
    );
    expect(await aiChatCompletion([], tool, fakeCaller)).toEqual({
      ok: true,
      args: { value: "ok" },
    });
  });

  test("finds a fenced block that sits inside prose", async () => {
    stubProvider(
      Response.json({
        choices: [{ message: { content: 'Sure.\n```json\n{"value":"ok"}\n```\nDone.' } }],
      }),
    );
    expect(await aiChatCompletion([], tool, fakeCaller)).toEqual({
      ok: true,
      args: { value: "ok" },
    });
  });

  test("skips a reasoning block before the answer", async () => {
    stubProvider(
      Response.json({
        choices: [
          {
            message: {
              content: '<think>Draft: {"value":"draft"}. Better:</think>\n{"value":"ok"}',
            },
          },
        ],
      }),
    );
    expect(await aiChatCompletion([], tool, fakeCaller)).toEqual({
      ok: true,
      args: { value: "ok" },
    });
  });

  test("a brace inside a string does not end the object early", async () => {
    stubProvider(
      Response.json({ choices: [{ message: { content: 'Result: {"value":"a } b"}' } }] }),
    );
    expect(await aiChatCompletion([], tool, fakeCaller)).toEqual({
      ok: true,
      args: { value: "a } b" },
    });
  });

  test("a truncated reply never yields a nested fragment of itself", async () => {
    stubProvider(
      Response.json({
        choices: [{ message: { content: '{"outer":{"value":"ok"},"more":' } }],
      }),
    );
    expect(await aiChatCompletion([], tool, fakeCaller)).toEqual({ ok: false, status: 502 });
  });

  test("an unfinished reasoning block is never mined for a draft answer", async () => {
    stubProvider(
      Response.json({
        choices: [{ message: { content: '<think>Maybe {"value":"draft"} but let me check' } }],
      }),
    );
    expect(await aiChatCompletion([], tool, fakeCaller)).toEqual({ ok: false, status: 502 });
  });

  test("surfaces the provider status instead of throwing", async () => {
    stubProvider(new Response("slow down", { status: 429 }));
    expect(await aiChatCompletion([], tool, fakeCaller)).toEqual({ ok: false, status: 429 });
  });

  test("reports an unusable reply as 502", async () => {
    stubProvider(Response.json({ choices: [{ message: { content: "not json" } }] }));
    expect(await aiChatCompletion([], tool, fakeCaller)).toEqual({ ok: false, status: 502 });
  });

  test("surfaces a stuck/failed provider request as 504 instead of hanging or throwing", async () => {
    // Confirmed live: this was the one OpenRouter call site with no timeout
    // at all — unlike every image-generation call, which bounds its fetch
    // with AbortSignal.timeout. A slow/unresponsive provider left the
    // server function running indefinitely with no user-visible feedback.
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = mock(async () => {
      throw new DOMException("The operation was aborted.", "TimeoutError");
    }) as unknown as typeof fetch;

    expect(await aiChatCompletion([], tool, fakeCaller)).toEqual({ ok: false, status: 504 });
  });

  test("throws when OPENROUTER_API_KEY is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(aiChatCompletion([], tool, fakeCaller)).rejects.toThrow(
      "AI provider not configured",
    );
  });

  test("sends a reasoning budget only when one is provided", async () => {
    // The big compose calls otherwise spend ~10k reasoning tokens for a
    // ~1.5k answer (live probe); the budget bounds that. Absent the option,
    // the request shape is unchanged for every existing caller.
    process.env.OPENROUTER_API_KEY = "test-key";
    const fetchMock = mock(async () =>
      Response.json({ choices: [{ message: { content: '{"value":"ok"}' } }], usage: {} }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await aiChatCompletion([{ role: "user", content: "hi" }], tool, fakeCaller, {
      timeoutMs: 70_000,
      reasoningMaxTokens: 1024,
    });
    const first = JSON.parse(
      String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(first.reasoning).toEqual({ max_tokens: 1024 });

    await aiChatCompletion([{ role: "user", content: "hi" }], tool, fakeCaller);
    const second = JSON.parse(
      String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body),
    );
    expect(second.reasoning).toBeUndefined();
  });

  test("retries once on the shipped default when the provider rejects the configured model id", async () => {
    // QA F-MA-007: the admin console accepts custom ids behind a format-only
    // check, so one typo could otherwise fail every AI call until staff
    // notice. The provider rejects the model with a 404 that names it; the
    // gateway answers with one retry on the shipped default instead.
    process.env.OPENROUTER_API_KEY = "test-key";
    const fetchMock = mock(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.model === "deepseek/deepseek-v4.1-flash") {
        return Response.json({ choices: [{ message: { content: '{"value":"ok"}' } }], usage: {} });
      }
      return new Response(
        JSON.stringify({ error: { message: `No endpoints found for ${body.model}.` } }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await aiChatCompletion([{ role: "user", content: "hi" }], tool, fakeCaller, {
      model: "vendor/typo-model",
    });

    expect(result).toEqual({ ok: true, args: { value: "ok" } });
    expect(fetchMock.mock.calls.length).toBe(2);
    const first = JSON.parse(
      String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    const second = JSON.parse(
      String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body),
    );
    expect(first.model).toBe("vendor/typo-model");
    expect(second.model).toBe("deepseek/deepseek-v4.1-flash");
  });

  test("keeps a non-model 404 as-is — no retry, no double request", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const fetchMock = mock(async () => new Response("not here", { status: 404 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await aiChatCompletion([], tool, fakeCaller, { model: "vendor/typo-model" })).toEqual({
      ok: false,
      status: 404,
    });
    expect(fetchMock.mock.calls.length).toBe(1);
  });
});
