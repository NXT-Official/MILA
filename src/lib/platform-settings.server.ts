import type { Database } from "@/integrations/supabase/types";

/**
 * The AI models behind styling are switchable from the admin console
 * (`MILA_ADMIN/src/routes/_authed/ai-settings.tsx` writes the
 * `platform_settings` row); every AI call site reads the current choice
 * through {@link resolveTextModel} / {@link resolveImageModel} instead of a
 * hard-coded constant, so a switch takes effect without a deploy.
 *
 * The values below are the shipped defaults: they are also the schema defaults
 * and the fallback whenever the settings row cannot be read (missing table on
 * an older deployment, a transient database error) — generation must keep
 * working with the model the code was written for, never fail because staff
 * configuration was unreachable.
 */
export const DEFAULT_AI_TEXT_MODEL = "deepseek/deepseek-v4.1-flash";
export const DEFAULT_AI_IMAGE_MODEL = "meta/muse-image";

export interface PlatformModelSettings {
  ai_text_model: string;
  ai_image_model: string;
}

export type PlatformSettingsLoader = () => Promise<Partial<PlatformModelSettings> | null>;

export interface ModelResolverOptions {
  /** How long a loaded row is trusted, in milliseconds. */
  ttlMs?: number;
  now?: () => number;
}

/**
 * One shared shape for "read the current model, with fallbacks": a short
 * in-process cache keeps a database read off the hot path of every AI call,
 * and concurrent callers share a single in-flight load. A failed load resolves
 * to the defaults — the caller can always put a model in the request.
 */
export function createModelResolver(
  load: PlatformSettingsLoader,
  options: ModelResolverOptions = {},
) {
  const ttlMs = options.ttlMs ?? 30_000;
  const now = options.now ?? Date.now;
  let cache: { at: number; settings: PlatformModelSettings } | null = null;
  let inFlight: Promise<PlatformModelSettings> | null = null;

  async function resolve(): Promise<PlatformModelSettings> {
    if (cache && now() - cache.at < ttlMs) return cache.settings;
    if (!inFlight) {
      inFlight = load()
        .then((loaded) => ({
          ai_text_model: pickModel(loaded?.ai_text_model, DEFAULT_AI_TEXT_MODEL),
          ai_image_model: pickModel(loaded?.ai_image_model, DEFAULT_AI_IMAGE_MODEL),
        }))
        .catch((err) => {
          console.error("[platform-settings] falling back to default models", err);
          return {
            ai_text_model: DEFAULT_AI_TEXT_MODEL,
            ai_image_model: DEFAULT_AI_IMAGE_MODEL,
          };
        })
        .then((settings) => {
          cache = { at: now(), settings };
          inFlight = null;
          return settings;
        });
    }
    return inFlight;
  }

  return {
    resolve,
    /** Drops the cache — used by tests and after an admin update. */
    clear() {
      cache = null;
      inFlight = null;
    },
  };
}

function pickModel(value: string | null | undefined, fallback: string): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

async function loadFromDatabase(): Promise<Partial<PlatformModelSettings> | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("platform_settings")
    .select("ai_text_model,ai_image_model")
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const resolver = createModelResolver(loadFromDatabase);

/** The model the next text/vision call should use (admin-switchable). */
export async function resolveTextModel(): Promise<string> {
  return (await resolver.resolve()).ai_text_model;
}

/** The model the next image generation call should use (admin-switchable). */
export async function resolveImageModel(): Promise<string> {
  return (await resolver.resolve()).ai_image_model;
}

export function resetPlatformSettingsCache(): void {
  resolver.clear();
}

export type PlatformSettingsRead = Database["public"]["Tables"]["platform_settings"]["Row"];
