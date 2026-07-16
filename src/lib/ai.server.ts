type ChatCompletionRequest = {
  messages: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: Record<string, unknown>;
};

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function aiEnv() {
  return { apiKey: process.env.AI_API_KEY, model: process.env.AI_MODEL };
}

export function isAiConfigured(): boolean {
  const { apiKey, model } = aiEnv();
  return Boolean(apiKey && model);
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

export async function aiChatCompletion(request: ChatCompletionRequest): Promise<Response> {
  const { apiKey, model } = aiEnv();
  if (!apiKey || !model) {
    throw new Error("AI provider not configured — set AI_API_KEY and AI_MODEL");
  }

  const system = request.messages
    .filter((message) => message.role === "system" && typeof message.content === "string")
    .map((message) => message.content as string);
  const contents: Array<{ role: "user" | "model"; parts: GeminiPart[] }> = [];
  for (const message of request.messages) {
    if (message.role === "system") continue;
    const role = message.role === "assistant" ? "model" : "user";
    const parts = await messageParts(message.content);
    if (!parts.length) continue;
    const previous = contents.at(-1);
    if (previous?.role === role) previous.parts.push(...parts);
    else contents.push({ role, parts });
  }

  const requestedName = (request.tool_choice?.function as { name?: unknown } | undefined)?.name;
  const selectedTool = request.tools?.find(
    (tool) =>
      tool.type === "function" &&
      (!requestedName || (tool.function as { name?: unknown } | undefined)?.name === requestedName),
  );
  const fn = selectedTool?.function as
    { name?: string; parameters?: Record<string, unknown> } | undefined;
  if (fn?.name) {
    system.push(`Return only the ${fn.name} arguments as JSON matching the required schema.`);
  }

  const response = await fetch(`${GEMINI_API}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      systemInstruction: system.length ? { parts: [{ text: system.join("\n\n") }] } : undefined,
      generationConfig: fn?.parameters
        ? { responseMimeType: "application/json", responseJsonSchema: fn.parameters }
        : undefined,
      store: false,
    }),
  });
  if (!response.ok) return response;

  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
  if (!text) {
    return Response.json(json, { status: 502, statusText: "Invalid AI response" });
  }
  return Response.json({
    choices: [
      {
        message: fn?.name
          ? { tool_calls: [{ function: { name: fn.name, arguments: text } }] }
          : { content: text },
      },
    ],
  });
}
