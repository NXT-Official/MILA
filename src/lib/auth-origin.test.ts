import { describe, expect, test } from "bun:test";
import { MILA_DEPLOYMENT_ORIGINS, authOriginConfig, pickAuthOrigin } from "./auth-origin";

const LIVE = "https://mila-umber.vercel.app";
const PREVIEW = "https://mila-nicoledev.vercel.app";

describe("pickAuthOrigin: auth links never point at a forged host", () => {
  const production = authOriginConfig({ NODE_ENV: "production" });

  test("the known Mila deployments are the default allowlist", () => {
    expect([...MILA_DEPLOYMENT_ORIGINS]).toEqual([LIVE, PREVIEW]);
  });

  test("a forged Host (request URL) gets the canonical URL", () => {
    expect(pickAuthOrigin([undefined, "https://evil.example"], production)).toBe(LIVE);
  });

  test("a forged Origin header gets the canonical URL", () => {
    expect(pickAuthOrigin(["https://evil.example", "https://evil.example"], production)).toBe(LIVE);
    // A forged Origin cannot override a real, allowed host either way.
    expect(pickAuthOrigin(["https://evil.example", PREVIEW], production)).toBe(PREVIEW);
  });

  test("each allowed origin is kept", () => {
    expect(pickAuthOrigin([LIVE], production)).toBe(LIVE);
    expect(pickAuthOrigin([PREVIEW], production)).toBe(PREVIEW);
    expect(pickAuthOrigin([`${PREVIEW}/some/path?x=1`], production)).toBe(PREVIEW);
  });

  test("look-alikes and junk are refused", () => {
    for (const forged of [
      "https://mila-nicoledev.vercel.app.evil.example",
      "https://evil-mila-nicoledev.vercel.app",
      "http://mila-nicoledev.vercel.app",
      "https://mila-nicoledev.vercel.app:8443",
      "null",
      "javascript:alert(1)",
      "mila-nicoledev.vercel.app",
      "",
    ]) {
      expect({ forged, origin: pickAuthOrigin([forged], production) }).toEqual({
        forged,
        origin: LIVE,
      });
    }
  });

  test("the deployment's own Vercel URLs are allowed, and its production URL is the fallback", () => {
    const onPreviewProject = authOriginConfig({
      NODE_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "mila-nicoledev.vercel.app",
      VERCEL_URL: "mila-nicoledev-abc123-team.vercel.app",
      VERCEL_BRANCH_URL: "mila-nicoledev-git-nicoledev-team.vercel.app",
    });
    expect(pickAuthOrigin(["https://evil.example"], onPreviewProject)).toBe(PREVIEW);
    expect(
      pickAuthOrigin(["https://mila-nicoledev-abc123-team.vercel.app"], onPreviewProject),
    ).toBe("https://mila-nicoledev-abc123-team.vercel.app");
    expect(
      pickAuthOrigin(["https://mila-nicoledev-git-nicoledev-team.vercel.app"], onPreviewProject),
    ).toBe("https://mila-nicoledev-git-nicoledev-team.vercel.app");
  });

  test("unparseable or non-string candidates are skipped without throwing", () => {
    const hostile: unknown[] = [42, {}, null, "http://[", "https://", "://evil", "%%%"];
    expect(() => pickAuthOrigin(hostile, production)).not.toThrow();
    expect(pickAuthOrigin(hostile, production)).toBe(LIVE);
    // A bad candidate before a good one does not stop the good one.
    expect(pickAuthOrigin(["http://[", PREVIEW], production)).toBe(PREVIEW);
  });

  test("localhost is allowed in development only", () => {
    const dev = authOriginConfig({ NODE_ENV: "development" });
    expect(pickAuthOrigin(["https://localhost:8080"], dev)).toBe("https://localhost:8080");
    expect(pickAuthOrigin(["http://127.0.0.1:5173"], dev)).toBe("http://127.0.0.1:5173");
    expect(pickAuthOrigin(["https://localhost:8080"], production)).toBe(LIVE);
  });
});
