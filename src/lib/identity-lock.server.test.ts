import { describe, expect, test } from "bun:test";
import { buildIdentityLockLine } from "./identity-lock.server";

describe("buildIdentityLockLine", () => {
  test("includes the core protected-region list regardless of gender", () => {
    const line = buildIdentityLockLine(null);
    expect(line).toContain("Preserve exactly: the person's face, identity, facial structure");
    expect(line).toContain("Do not beautify, smooth, symmetrize");
  });

  test("omits the gender-presentation guard when gender is unknown", () => {
    expect(buildIdentityLockLine(null)).not.toContain("presenting person");
    expect(buildIdentityLockLine("Prefer not to say")).not.toContain("presenting person");
  });

  test("adds a gender-presentation guard naming the stated gender", () => {
    const line = buildIdentityLockLine("Female");
    expect(line).toContain("female-presenting person");
    expect(line).toContain("never shift apparent gender");
  });
});
