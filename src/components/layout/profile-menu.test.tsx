import { describe, expect, test } from "bun:test";
import { renderAppMarkup } from "../../../tests/helpers/render-app-markup";
import { ProfileMenu } from "./profile-menu";

describe("ProfileMenu trigger", () => {
  test("the avatar is a menu button named 'Your account', not a link away", async () => {
    const out = await renderAppMarkup(
      <ProfileMenu triggerClassName="rounded-full">
        <span>A</span>
      </ProfileMenu>,
      { userId: "u1" },
    );
    const trigger = out.match(/<button[^>]*aria-label="Your account"[^>]*>/)?.[0] ?? "";
    expect(trigger).toContain('aria-haspopup="menu"');
    expect(trigger).toContain('aria-expanded="false"');
    expect(trigger).toContain('type="button"');
    expect(trigger).toContain("rounded-full");
    expect(out).toContain("<span>A</span>");
    expect(out).not.toContain('href="/account"');
  });
});
