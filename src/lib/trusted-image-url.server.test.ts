import assert from "node:assert/strict";
import { describe, test, beforeEach, afterEach } from "node:test";
import { assertTrustedStorageImageUrl } from "./trusted-image-url.server";

const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;

describe("assertTrustedStorageImageUrl", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://project-ref.supabase.co";
  });
  afterEach(() => {
    process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  });

  test("accepts a URL under our own storage public-object prefix", () => {
    const url = "https://project-ref.supabase.co/storage/v1/object/public/outfits/u/1.jpg";
    assert.equal(assertTrustedStorageImageUrl(url), url);
  });

  test("rejects an arbitrary external https host (SSRF-adjacent forwarding)", () => {
    assert.throws(() => assertTrustedStorageImageUrl("https://evil.example.com/x.jpg"));
  });

  test("rejects a cloud-metadata-style host", () => {
    assert.throws(() => assertTrustedStorageImageUrl("http://169.254.169.254/latest/meta-data/"));
  });

  test("rejects a look-alike host that merely contains the project ref", () => {
    assert.throws(() =>
      assertTrustedStorageImageUrl(
        "https://project-ref.supabase.co.evil.com/storage/v1/object/public/x",
      ),
    );
  });

  test("rejects our own host but outside the public-object path", () => {
    assert.throws(() =>
      assertTrustedStorageImageUrl("https://project-ref.supabase.co/rest/v1/profiles"),
    );
  });

  test("rejects non-https schemes even on the trusted host", () => {
    assert.throws(() =>
      assertTrustedStorageImageUrl("http://project-ref.supabase.co/storage/v1/object/public/x"),
    );
  });
});
