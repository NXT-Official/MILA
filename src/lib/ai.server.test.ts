import { afterAll, describe, expect, mock, test } from "bun:test";
import { aiChatCompletion } from "./ai.server";

const originalFetch = globalThis.fetch;
const originalKey = process.env.AI_API_KEY;
const originalModel = process.env.AI_MODEL;

afterAll(() => {
  globalThis.fetch = originalFetch;
  process.env.AI_API_KEY = originalKey;
  process.env.AI_MODEL = originalModel;
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
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "gemini-test";
  const fetchMock = mock(async () => response);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe("Gemini gateway", () => {
  test("sends native structured output and returns the parsed tool arguments", async () => {
    const fetchMock = stubProvider(
      Response.json({ candidates: [{ content: { parts: [{ text: '{"value":"ok"}' }] } }] }),
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
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent",
    );
    expect(body.contents[0].parts[1]).toEqual({
      inlineData: { mimeType: "image/jpeg", data: "YQ==" },
    });
    expect(body.generationConfig.responseJsonSchema.additionalProperties).toBe(false);
    expect(body.systemInstruction.parts[0].text).toContain("report_test");
    expect(result).toEqual({ ok: true, args: { value: "ok" } });
  });

  test("tolerates a fenced JSON reply", async () => {
    stubProvider(
      Response.json({
        candidates: [{ content: { parts: [{ text: '```json\n{"value":"ok"}\n```' }] } }],
      }),
    );
    expect(await aiChatCompletion([], tool)).toEqual({ ok: true, args: { value: "ok" } });
  });

  test("surfaces the provider status instead of throwing", async () => {
    stubProvider(new Response("slow down", { status: 429 }));
    expect(await aiChatCompletion([], tool)).toEqual({ ok: false, status: 429 });
  });

  test("reports an unusable reply as 502", async () => {
    stubProvider(Response.json({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }));
    expect(await aiChatCompletion([], tool)).toEqual({ ok: false, status: 502 });
  });
});
