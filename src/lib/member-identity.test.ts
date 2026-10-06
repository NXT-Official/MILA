import { describe, expect, test } from "bun:test";
import { memberIdentity } from "./member-identity";

describe("memberIdentity", () => {
  test("a member with a name and a username shows both", () => {
    expect(memberIdentity({ fullName: "Ana Reyes", username: "ana_r" })).toEqual({
      displayName: "Ana Reyes",
      handle: "ana_r",
    });
  });

  test("with no name set, the username stands in as the display name", () => {
    expect(memberIdentity({ fullName: "", username: "milaqa_1006" })).toEqual({
      displayName: "milaqa_1006",
      handle: "milaqa_1006",
    });
  });

  test("a name that is only whitespace counts as no name", () => {
    expect(memberIdentity({ fullName: "   ", username: "milaqa_1006" }).displayName).toBe(
      "milaqa_1006",
    );
  });

  test("a null name falls back to the username", () => {
    expect(memberIdentity({ fullName: null, username: "milaqa_1006" }).displayName).toBe(
      "milaqa_1006",
    );
  });

  test("while nothing has loaded there is no handle and the name is a plain Member", () => {
    expect(memberIdentity({})).toEqual({ displayName: "Member", handle: null });
    expect(memberIdentity({ fullName: null, username: null })).toEqual({
      displayName: "Member",
      handle: null,
    });
  });

  test("a blank username is not a handle", () => {
    expect(memberIdentity({ fullName: "Ana Reyes", username: "  " })).toEqual({
      displayName: "Ana Reyes",
      handle: null,
    });
  });
});
