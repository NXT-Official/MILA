import { createMiddleware } from "@tanstack/react-start";

export const globalRateLimitMiddleware = createMiddleware().server(async (context) =>
  (await import("./rate-limit-middleware-handler.server")).handleGlobalRateLimit(context),
);
