import { describe, expect, test } from "bun:test";
import { renderAppMarkup } from "../../../tests/helpers/render-app-markup";
import { Sidebar } from "./sidebar";

function renderSidebar(path = "/dashboard") {
  return renderAppMarkup(
    <Sidebar
      path={path}
      expanded
      onToggleExpanded={() => {}}
      onOpenLens={() => {}}
      onOpenConcierge={() => {}}
      credits={3}
      displayName="Ana"
    />,
  );
}

/** Visible labels of the main navigation, in order. */
function navLabels(markup: string) {
  const nav = markup.slice(
    markup.indexOf('aria-label="Main navigation"'),
    markup.indexOf("</nav>"),
  );
  return [...nav.matchAll(/<span class="overflow-hidden[^"]*">([^<]+)<\/span>/g)].map(
    ([, label]) => label,
  );
}

describe("Sidebar main navigation", () => {
  test("Saved pieces sits right after Palettes and every earlier entry is kept", async () => {
    expect(navLabels(await renderSidebar())).toEqual([
      "Dashboard",
      "Feed",
      "History",
      "Palettes",
      "Saved pieces",
      "Studio",
    ]);
  });

  test("Saved pieces links to /saved and is marked active there", async () => {
    const out = await renderSidebar("/saved");
    expect(out).toContain('href="/saved"');
    const link = out.match(/<a[^>]*href="\/saved"[^>]*>/)?.[0] ?? "";
    expect(link).toContain("text-accent");
  });
});
