import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadProfilePhoto } from "./profile-photo-storage.server";

function fakeSupabase(uploadResult: { error: { message: string } | null }) {
  return {
    storage: {
      from: () => ({
        upload: async () => uploadResult,
      }),
    },
  } as unknown as SupabaseClient;
}

describe("uploadProfilePhoto", () => {
  test("rejects a non-data-URI string", async () => {
    await expect(
      uploadProfilePhoto({
        supabase: fakeSupabase({ error: null }),
        userId: "user-1",
        imageDataUri: "not-a-data-uri",
      }),
    ).rejects.toThrow("Unsupported or malformed image data");
  });

  test("rejects an unsupported image format", async () => {
    await expect(
      uploadProfilePhoto({
        supabase: fakeSupabase({ error: null }),
        userId: "user-1",
        imageDataUri: "data:image/gif;base64,R0lGODlh",
      }),
    ).rejects.toThrow("Unsupported or malformed image data");
  });

  test("rejects an empty payload", async () => {
    await expect(
      uploadProfilePhoto({
        supabase: fakeSupabase({ error: null }),
        userId: "user-1",
        imageDataUri: "data:image/jpeg;base64,",
      }),
    ).rejects.toThrow("Unsupported or malformed image data");
  });

  test("uploads a valid jpeg data URI and returns its storage path", async () => {
    const result = await uploadProfilePhoto({
      supabase: fakeSupabase({ error: null }),
      userId: "user-1",
      imageDataUri: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
    });
    expect(result.storagePath).toMatch(/^user-1\/[\w-]+\.jpg$/);
  });

  test("surfaces a friendly error when the storage upload fails", async () => {
    await expect(
      uploadProfilePhoto({
        supabase: fakeSupabase({ error: { message: "bucket unavailable" } }),
        userId: "user-1",
        imageDataUri: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
      }),
    ).rejects.toThrow("The photo could not be saved");
  });
});
