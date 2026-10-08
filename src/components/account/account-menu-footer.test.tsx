import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountShell } from "./account-menu";

const noop = () => {};

function renderShell(section: "security" | null, footer?: React.ReactNode) {
  return renderToStaticMarkup(
    <AccountShell section={section} wide={false} onSelect={noop} onBack={noop} menuFooter={footer}>
      <p>section body</p>
    </AccountShell>,
  );
}

describe("AccountShell menu footer", () => {
  test("renders under the section list, inside the menu column", () => {
    const out = renderShell(null, <a href="/saved">Saved pieces</a>);
    const menu = out.slice(out.indexOf("data-account-menu"), out.indexOf("data-account-detail"));
    expect(menu).toContain('<a href="/saved">Saved pieces</a>');
    expect(menu.indexOf("Saved pieces")).toBeGreaterThan(menu.indexOf("</nav>"));
  });

  test("on a phone it hides with the list when a section opens", () => {
    const out = renderShell("security", <a href="/saved">Saved pieces</a>);
    const menuTag = out.match(/<div[^>]*data-account-menu[^>]*>/)?.[0] ?? "";
    expect(menuTag).toContain("max-lg:hidden");
    expect(out).toContain("Saved pieces");
    expect(out.indexOf("Saved pieces")).toBeLessThan(out.indexOf("data-account-detail"));
  });

  test("without a footer the shell is unchanged", () => {
    expect(renderShell(null)).toBe(renderShell(null, undefined));
    expect(renderShell(null)).not.toContain("/saved");
  });
});
