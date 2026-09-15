-- Real token counts alongside cost_usd. Every provider we call reports
-- token usage directly (OpenRouter's usage object, Gemini's usageMetadata),
-- so this is measured, not estimated.
ALTER TABLE public.ai_spend_log
  ADD COLUMN prompt_tokens INTEGER,
  ADD COLUMN completion_tokens INTEGER,
  ADD COLUMN total_tokens INTEGER;
