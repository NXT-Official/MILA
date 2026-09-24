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
});
