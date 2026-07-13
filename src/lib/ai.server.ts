type ChatCompletionRequest = {
  messages: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: Record<string, unknown>;
};

function aiEnv() {
  return {
    apiKey: process.env.AI_API_KEY,
    baseUrl: process.env.AI_BASE_URL,
    model: process.env.AI_MODEL,
  };
}

export function isAiConfigured(): boolean {
  const { apiKey, baseUrl, model } = aiEnv();
  return Boolean(apiKey && baseUrl && model);
}

export async function aiChatCompletion(request: ChatCompletionRequest): Promise<Response> {
  const { apiKey, baseUrl, model } = aiEnv();
  if (!apiKey || !baseUrl || !model) {
    throw new Error("AI provider not configured — set AI_API_KEY, AI_BASE_URL and AI_MODEL");
  }
  return fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, ...request }),
  });
}
