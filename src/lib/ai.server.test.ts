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

describe("Gemini gateway", () => {
  test("uses native structured output and preserves the existing caller response shape", async () => {
    process.env.AI_API_KEY = "test-key";
    process.env.AI_MODEL = "gemini-test";
    const fetchMock = mock(async () =>
      Response.json({
        candidates: [{ content: { parts: [{ text: '{"value":"ok"}' }] } }],
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await aiChatCompletion({
      messages: [
        { role: "system", content: "Follow instructions." },
        {
          role: "user",
          content: [
            { type: "text", text: "Report a value." },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,YQ==" } },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "report_test",
            parameters: {
              type: "object",
              properties: { value: { type: "string" } },
              required: ["value"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "report_test" } },
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent",
    );
    expect(body.contents[0].parts[1]).toEqual({
      inlineData: { mimeType: "image/jpeg", data: "YQ==" },
    });
    expect(body.generationConfig.responseJsonSchema.additionalProperties).toBe(false);
    expect(await response.json()).toEqual({
      choices: [
        {
          message: {
            tool_calls: [{ function: { name: "report_test", arguments: '{"value":"ok"}' } }],
          },
        },
      ],
    });
  });
});
