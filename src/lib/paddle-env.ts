import { requireEnv } from "@/lib/env";

// Mirrors the client-side VITE_PADDLE_ENV switch in
// src/hooks/use-paddle-checkout.ts, server-side. Defaults to sandbox so
// local/dev/CI never need this var set — production deploys must set
// PADDLE_ENV=production explicitly.
function isProductionPaddle(): boolean {
  return process.env.PADDLE_ENV === "production";
}

export function getPaddleApiBase(): string {
  return isProductionPaddle() ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";
}

export function getPaddleApiKey(): string {
  if (isProductionPaddle()) {
    const { PADDLE_API_KEY } = requireEnv({ PADDLE_API_KEY: process.env.PADDLE_API_KEY });
    return PADDLE_API_KEY;
  }
  const { PADDLE_SANDBOX_API_KEY } = requireEnv({
    PADDLE_SANDBOX_API_KEY: process.env.PADDLE_SANDBOX_API_KEY,
  });
  return PADDLE_SANDBOX_API_KEY;
}

export function getPaddleWebhookSecret(): string {
  if (isProductionPaddle()) {
    const { PADDLE_WEBHOOK_SECRET } = requireEnv({
      PADDLE_WEBHOOK_SECRET: process.env.PADDLE_WEBHOOK_SECRET,
    });
    return PADDLE_WEBHOOK_SECRET;
  }
  const { PADDLE_SANDBOX_WEBHOOK_SECRET } = requireEnv({
    PADDLE_SANDBOX_WEBHOOK_SECRET: process.env.PADDLE_SANDBOX_WEBHOOK_SECRET,
  });
  return PADDLE_SANDBOX_WEBHOOK_SECRET;
}
