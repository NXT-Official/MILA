import { describe, expect, test } from "bun:test";
import {
  createModelResolver,
  DEFAULT_AI_IMAGE_MODEL,
  DEFAULT_AI_TEXT_MODEL,
} from "./platform-settings.server";

const settings = (text: string, image: string) => ({
  ai_text_model: text,
  ai_image_model: image,
});

describe("createModelResolver", () => {
  test("returns the loaded row when it is present", async () => {
    const resolver = createModelResolver(async () =>
      settings("anthropic/claude-opus-5.5", "google/gemini-3-pro-image"),
    );
    await expect(resolver.resolve()).resolves.toEqual(
      settings("anthropic/claude-opus-5.5", "google/gemini-3-pro-image"),
    );
  });

  test("falls back to the shipped defaults when there is no row yet", async () => {
    const resolver = createModelResolver(async () => null);
    await expect(resolver.resolve()).resolves.toEqual(
      settings(DEFAULT_AI_TEXT_MODEL, DEFAULT_AI_IMAGE_MODEL),
    );
  });

  test("falls back to the shipped defaults when the load throws", async () => {
    // A deployment whose migration has not run yet, or a transient database
    // error, must never break generation — the code was written against these
    // models and they are the schema defaults too.
    const resolver = createModelResolver(async () => {
      throw new Error('relation "platform_settings" does not exist');
    });
    await expect(resolver.resolve()).resolves.toEqual(
      settings(DEFAULT_AI_TEXT_MODEL, DEFAULT_AI_IMAGE_MODEL),
    );
  });

  test("treats blank and half-populated rows as unset, per field", async () => {
    const resolver = createModelResolver(async () => ({
      ai_text_model: "  ",
      ai_image_model: "openai/gpt-image-2.5-flare",
    }));
    await expect(resolver.resolve()).resolves.toEqual(
      settings(DEFAULT_AI_TEXT_MODEL, "openai/gpt-image-2.5-flare"),
    );
  });

  test("caches a loaded row until the ttl elapses, then reloads", async () => {
    let calls = 0;
    let models = settings("deepseek/deepseek-v4.1-flash", "meta/muse-image");
    let clock = 1_000;
    const resolver = createModelResolver(
      async () => {
        calls++;
        return models;
      },
      { ttlMs: 30_000, now: () => clock },
    );

    await resolver.resolve();
    await resolver.resolve();
    expect(calls).toBe(1);

    // A switched model is visible on the next call after the ttl — that is
    // what "switching models without a deploy" leans on.
    models = settings("openai/gpt-6-astra", "google/gemini-3.1-flash-image");
    clock += 29_000;
    await expect(resolver.resolve()).resolves.toEqual(
      settings("deepseek/deepseek-v4.1-flash", "meta/muse-image"),
    );
    expect(calls).toBe(1);

    clock += 2_000;
    await expect(resolver.resolve()).resolves.toEqual(
      settings("openai/gpt-6-astra", "google/gemini-3.1-flash-image"),
    );
    expect(calls).toBe(2);
  });

  test("a failed load is cached too, so one outage costs one query per ttl", async () => {
    let calls = 0;
    const resolver = createModelResolver(async () => {
      calls++;
      throw new Error("boom");
    });
    await resolver.resolve();
    await resolver.resolve();
    expect(calls).toBe(1);
  });

  test("concurrent callers share a single in-flight load", async () => {
    let calls = 0;
    let release: (() => void) | null = null;
    const resolver = createModelResolver(async () => {
      calls++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return settings("openai/gpt-6-luna", "meta/muse-image");
    });

    const first = resolver.resolve();
    const second = resolver.resolve();
    release?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      settings("openai/gpt-6-luna", "meta/muse-image"),
      settings("openai/gpt-6-luna", "meta/muse-image"),
    ]);
    expect(calls).toBe(1);
  });
});

/**
 * The wire bodies are the half of the switch that the resolver tests cannot
 * see: whatever the console writes into platform_settings only matters if the
 * requests actually send the resolved model. bun's module mocking is
 * process-wide (it leaks into every other test file), so the invariant is
 * pinned against the source instead — the same way security-boundaries.test.ts
 * guards the route table.
 */
describe("every AI request site resolves its model through the settings", () => {
  const wireSources = [
    "ai.server.ts",
    "openrouter-image.server.ts",
    "openrouter-photo-edit.server.ts",
    "openrouter-style-sheet.server.ts",
  ];

  for (const file of wireSources) {
    test(`${file} resolves the model at call time instead of sending a constant`, async () => {
      const source = await Bun.file(new URL(file, import.meta.url)).text();
      expect(source).toMatch(/await resolve(Text|Image)Model\(\)/);
      // Sending the module-level constant would silently ignore the console.
      expect(source).not.toMatch(
        /model:\s*(TEXT_MODEL|IMAGE_MODEL|PHOTO_EDIT_MODEL|STYLE_SHEET_MODEL)\b/,
      );
    });
  }
});
