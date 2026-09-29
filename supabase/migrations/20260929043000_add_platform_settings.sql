-- Platform settings — the single row of admin-controlled knobs the member app
-- reads at request time, so staff can switch the AI models behind styling (and
-- adjust how revenue tax is reported) without a deploy.
--
-- Read and write both go through service-role clients:
--   * MILA_ADMIN's /ai-settings screen writes it from staff server functions;
--   * the member app reads it per call in src/lib/platform-settings.server.ts
--     (short in-process cache) from ai.server.ts and the openrouter-*.server.ts
--     modules — that is what makes a switch take effect without a deploy;
--   * the admin analytics screen reads the tax columns for net revenue.
-- RLS is enabled with no policies and client roles are revoked: anon and
-- authenticated can neither read nor write it — same posture as
-- staff_audit_log.
CREATE TABLE public.platform_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  -- OpenRouter model ids, '<vendor>/<model>' (e.g. 'meta/muse-image').
  ai_text_model TEXT NOT NULL DEFAULT 'deepseek/deepseek-v4.1-flash'
    CHECK (
      length(ai_text_model) BETWEEN 3 AND 120
      AND ai_text_model ~ '^[a-z0-9][a-z0-9._-]*/[A-Za-z0-9._:%-]+$'
    ),
  ai_image_model TEXT NOT NULL DEFAULT 'meta/muse-image'
    CHECK (
      length(ai_image_model) BETWEEN 3 AND 120
      AND ai_image_model ~ '^[a-z0-9][a-z0-9._-]*/[A-Za-z0-9._:%-]+$'
    ),
  -- Revenue reporting: the tax deducted from gross revenue is either a fixed
  -- amount (major currency units, e.g. 12.50) or a percentage of gross.
  tax_deduction_kind TEXT NOT NULL DEFAULT 'percent'
    CHECK (tax_deduction_kind IN ('amount', 'percent')),
  tax_deduction_value NUMERIC(10, 4) NOT NULL DEFAULT 0
    CHECK (tax_deduction_value >= 0 AND tax_deduction_value <= 1000000),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row, always: any other insert fails the primary key.
INSERT INTO public.platform_settings (id) VALUES (TRUE);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.platform_settings FROM PUBLIC, anon, authenticated;

CREATE TRIGGER update_platform_settings_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.platform_settings IS
  'Single-row admin settings: active AI models and revenue tax. Service-role only.';
