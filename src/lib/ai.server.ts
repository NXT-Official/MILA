type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export type AiTool = { function: { name: string; parameters: Record<string, unknown> } };

export type AiResult = { ok: true; args: unknown } | { ok: false; status: number };

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function isAiConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY && process.env.AI_MODEL);
}

export function aiFailure(status: number, fallback: string): Error {
  if (status === 429) return new Error("Rate limit reached. Please try again in a moment.");
  if (status === 402) return new Error("AI credits exhausted. Please try again later.");
  return new Error(fallback);
}

async function imagePart(url: string): Promise<GeminiPart> {
  const inline = url.match(/^data:(image\/[\w.+-]+);base64,(.+)$/s);
  if (inline) return { inlineData: { mimeType: inline[1], data: inline[2] } };

  const response = await fetch(url);
  if (!response.ok) throw new Error("Mila couldn't load the image for analysis.");
  const bytes = await response.arrayBuffer();
  const mimeType = response.headers.get("content-type")?.split(";")[0];
  if (!mimeType?.startsWith("image/") || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("Mila couldn't use that image for analysis.");
  }
  return { inlineData: { mimeType, data: Buffer.from(bytes).toString("base64") } };
}

async function messageParts(content: unknown): Promise<GeminiPart[]> {
  if (typeof content === "string") return [{ text: content }];
  if (!Array.isArray(content)) return [];

  const parts: GeminiPart[] = [];
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
      parts.push(await imagePart(part.image_url.url));
    }
  }
  return parts;
}

export async function aiChatCompletion(
  messages: Array<Record<string, unknown>>,
  tool: AiTool,
): Promise<AiResult> {
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;
  if (!apiKey || !model) {
    throw new Error("AI provider not configured — set AI_API_KEY and AI_MODEL");
  }

  const system = messages
    .filter((message) => message.role === "system" && typeof message.content === "string")
    .map((message) => message.content as string);
  system.push(
    `Return only the ${tool.function.name} arguments as JSON matching the required schema.`,
  );

  const contents: Array<{ role: "user" | "model"; parts: GeminiPart[] }> = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    const role = message.role === "assistant" ? "model" : "user";
    const parts = await messageParts(message.content);
    if (!parts.length) continue;
    const previous = contents.at(-1);
    if (previous?.role === role) previous.parts.push(...parts);
    else contents.push({ role, parts });
  }

  const response = await fetch(`${GEMINI_API}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: system.join("\n\n") }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: tool.function.parameters,
      },
      store: false,
    }),
  });
  if (!response.ok) {
    console.error("[ai] provider error", response.status, await response.text());
    return { ok: false, status: response.status };
  }

  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
  if (!text) {
    console.error("[ai] provider returned no text", JSON.stringify(json).slice(0, 500));
    return { ok: false, status: 502 };
  }

  try {
    return { ok: true, args: JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")) };
  } catch {
    console.error("[ai] provider returned unparseable JSON", text.slice(0, 500));
    return { ok: false, status: 502 };
  }
}
