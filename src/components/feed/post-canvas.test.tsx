import { describe, expect, test } from "bun:test";
import type { FeedPost } from "@/lib/posts.functions";
import { renderAppMarkup } from "../../../tests/helpers/render-app-markup";
import { PostCanvas } from "./post-canvas";

function post(overrides: Partial<FeedPost>): FeedPost {
  return {
    id: "p1",
    user_id: "u1",
    caption: null,
    created_at: new Date().toISOString(),
    generated_look_id: null,
    image_url_back: "",
    image_url_front: "",
    author_name: "Yara Cole",
    author_verified: false,
    is_self: true,
    items: [],
    ...overrides,
  };
}

describe("PostCanvas header", () => {
  test("her older post shows a date label and her real initial", async () => {
    const html = await renderAppMarkup(
      <PostCanvas post={post({ created_at: "2020-03-05T12:00:00" })} />,
    );
    expect(html).not.toContain("Today&#x27;s OOTD");
    expect(html).toContain("Mar 5");
    expect(html).toContain(">Y</span>");
    expect(html).toContain(">You</a>");
  });

  test("her post from today says Today's OOTD", async () => {
    const html = await renderAppMarkup(<PostCanvas post={post({})} />);
    expect(html).toContain("Today&#x27;s OOTD");
  });
});
