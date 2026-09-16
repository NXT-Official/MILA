import { logAiSpend } from "./ai-spend.server";
import type { AiCallerContext, AiResult, AiTool } from "./ai.server";

// Cloudflare's vision REST endpoint accepts exactly one image per call (a
// single `image` field, not an array) — confirmed against the documented
// input schema. A caller sending 2+ images (e.g. an original-vs-edited
// comparison) must not have the extras silently dropped: that produced a
// vacuous "pass" earlier (the check only ever saw the first image and
// never the one it was supposed to judge). Throw instead so callers can
// adapt — see photo-preview.functions.ts's single-image fallback.
export class CloudflareMultiImageUnsupportedError extends Error {
  constructor() {
    super("Cloudflare Workers AI vision only supports one image per call.");
    this.name = "CloudflareMultiImageUnsupportedError";
  }
}

// Temporary stand-in for the Gemini stylist brain while AI_API_KEY/AI_MODEL
// are unconfigured. Reuses the same Cloudflare Workers AI Free-plan account
// already wired up for outfit images, so it costs nothing extra to enable
// and can be dropped the moment a real Gemini key is set (see ai.server.ts).
const TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

type ChatMessage = { text: string } | { imageUrl: string };

function extractParts(content: unknown): ChatMessage[] {
  if (typeof content === "string") return [{ text: content }];
  if (!Array.isArray(content)) return [];

  const parts: ChatMessage[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if ("text" in part && typeof part.text === "string") parts.push({ text: part.text });
    if (
      "image_url" in part &&
      part.image_url &&
      typeof part.image_url === "object" &&
      "url" in part.image_url &&
      typeof part.image_url.url === "string"
    ) {
      parts.push({ imageUrl: part.image_url.url });
    }
  }
  return parts;
}

async function imageToByteArray(url: string): Promise<number[]> {
  const inline = url.match(/^data:image\/[\w.+-]+;base64,(.+)$/s);
  const bytes = inline
    ? Buffer.from(inline[1], "base64")
    : await (async () => {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Mila couldn't load the image for analysis.");
        return Buffer.from(await response.arrayBuffer());
      })();
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("Mila couldn't use that image for analysis.");
  }
  return Array.from(bytes);
}

function stripJsonFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
}

// The vision model doesn't honor response_format/json_schema (confirmed via
// a live smoke test — Cloudflare silently ignores it for this model). A
// concrete filled-in example is far more reliably followed than an abstract
// schema dump, so build one from the tool's JSON schema instead of quoting
// the schema itself.
function exampleFromSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return null;
  const s = schema as {
    type?: string;
    enum?: unknown[];
    properties?: Record<string, unknown>;
    items?: unknown;
  };
  // Show the full valid vocabulary, not just the first option — a single
  // example value lets the model guess a plausible-sounding synonym (e.g.
  // "Footwear" instead of the actual allowed "Shoes") for anything it
  // hasn't seen the rest of the list for.
  if (s.enum?.length) return `<EXACTLY one of: ${s.enum.join(" | ")}>`;
  if (s.type === "object" && s.properties) {
    return Object.fromEntries(
      Object.entries(s.properties).map(([key, value]) => [key, exampleFromSchema(value)]),
    );
  }
  if (s.type === "array") return s.items ? [exampleFromSchema(s.items)] : [];
  if (s.type === "number" || s.type === "integer") return 0;
  if (s.type === "boolean") return false;
  return "...";
}

export function isCloudflareChatConfigured(): boolean {
  return Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);
}

/**
 * Repair path for vision responses that don't parse as JSON. Very long,
 * elaborate system prompts (this app's color-analysis prompts run to
 * thousands of tokens) reliably make the 11B vision model answer in prose
 * or markdown instead of raw JSON — confirmed live: the model still gets
 * the analysis right, it just narrates it. Rather than losing that answer,
 * hand the raw text to the text model, which has confirmed reliable native
 * json_schema enforcement, and ask it to structure what's already there.
 */
async function repairViaTextModel(
  rawText: string,
  tool: AiTool,
  accountId: string,
  apiToken: string,
): Promise<{ response: Record<string, unknown>; usage?: CloudflareUsage } | null> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${TEXT_MODEL}`;
  const body = {
    messages: [
      {
        role: "system",
        content: `Extract the answer already present in the following text into strict JSON matching the schema. Do not invent new facts — only restructure what's given. If a value doesn't exactly match an allowed enum option, pick the closest valid option.\n\nTEXT:\n${rawText}`,
      },
      { role: "user", content: "Extract now." },
    ],
    response_format: { type: "json_schema", json_schema: tool.function.parameters },
    max_tokens: 1024,
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return null;
  const json = (await response.json()) as CloudflareEnvelope;
  if (!json.success || typeof json.result?.response !== "object" || !json.result.response) {
    return null;
  }
  return { response: json.result.response, usage: json.result.usage };
}

type CloudflareUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};
type CloudflareEnvelope = {
  success: boolean;
  result?: { response?: string | Record<string, unknown>; usage?: CloudflareUsage };
  errors?: Array<{ message: string }>;
};

export async function cloudflareChatCompletion(
  messages: Array<Record<string, unknown>>,
  tool: AiTool,
  caller: AiCallerContext,
): Promise<AiResult> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error(
      "AI provider not configured — set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN",
    );
  }

  const systemTexts: string[] = [];
  const turns: Array<{ role: "system" | "user" | "assistant"; text: string }> = [];
  const imageUrls: string[] = [];

  for (const message of messages) {
    const role =
      message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user";
    const parts = extractParts(message.content);
    const text = parts
      .filter((part): part is { text: string } => "text" in part)
      .map((part) => part.text)
      .join("\n");
    if (role === "system") {
      if (text) systemTexts.push(text);
      continue;
    }
    if (text) turns.push({ role, text });
    for (const part of parts) {
      if ("imageUrl" in part) imageUrls.push(part.imageUrl);
    }
  }

  if (imageUrls.length > 1) throw new CloudflareMultiImageUnsupportedError();
  const firstImage = imageUrls.length ? await imageToByteArray(imageUrls[0]) : null;

  const model = firstImage ? VISION_MODEL : TEXT_MODEL;
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  const body: Record<string, unknown> = firstImage
    ? {
        prompt: [
          ...systemTexts,
          ...turns.map((turn) => turn.text),
          `Respond with ONLY this exact JSON shape, filled in with your real answer, nothing else, no explanation, no markdown fences:\n${JSON.stringify(exampleFromSchema(tool.function.parameters))}`,
        ].join("\n\n"),
        image: firstImage,
        max_tokens: 2048,
        temperature: 0.2,
      }
    : {
        messages: [
          {
            role: "system",
            content: [
              ...systemTexts,
              `Return only the ${tool.function.name} arguments as strict JSON matching this schema, with no markdown fences and no commentary:\n${JSON.stringify(tool.function.parameters)}`,
            ].join("\n\n"),
          },
          ...turns.map((turn) => ({ role: turn.role, content: turn.text })),
        ],
        response_format: { type: "json_schema", json_schema: tool.function.parameters },
        max_tokens: 2048,
      };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    console.error("[cloudflare-chat] provider error", response.status, await response.text());
    return { ok: false, status: response.status };
  }

  // When response_format:json_schema is used, Cloudflare returns the
  // already-parsed object here rather than a JSON string (confirmed via a
  // live smoke test — the documented "response: string" shape only holds
  // for the plain-prompt/vision path).
  const json = (await response.json()) as CloudflareEnvelope;
  if (!json.success || json.result?.response === undefined) {
    console.error(
      "[cloudflare-chat] provider returned no text",
      JSON.stringify(json).slice(0, 500),
    );
    return { ok: false, status: 502 };
  }

  await logAiSpend(caller.supabase, caller.userId, {
    provider: "cloudflare",
    model,
    costUsd: 0,
    promptTokens: json.result.usage?.prompt_tokens ?? null,
    completionTokens: json.result.usage?.completion_tokens ?? null,
    totalTokens: json.result.usage?.total_tokens ?? null,
  });

  if (typeof json.result.response !== "string") {
    return { ok: true, args: json.result.response };
  }
  try {
    return { ok: true, args: JSON.parse(stripJsonFence(json.result.response)) };
  } catch {
    console.error("[cloudflare-chat] provider returned unparseable JSON, attempting repair", {
      length: json.result.response.length,
    });
    const repaired = await repairViaTextModel(json.result.response, tool, accountId, apiToken);
    if (!repaired) return { ok: false, status: 502 };
    await logAiSpend(caller.supabase, caller.userId, {
      provider: "cloudflare",
      model: `${TEXT_MODEL} (repair)`,
      costUsd: 0,
      promptTokens: repaired.usage?.prompt_tokens ?? null,
      completionTokens: repaired.usage?.completion_tokens ?? null,
      totalTokens: repaired.usage?.total_tokens ?? null,
    });
    return { ok: true, args: repaired.response };
  }
}
