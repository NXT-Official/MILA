import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountMenu, AccountShell } from "./account-menu";
import { ACCOUNT_SECTIONS } from "./account-sections";

const noop = () => {};

function renderMenu(current: Parameters<typeof AccountMenu>[0]["current"]) {
  return renderToStaticMarkup(<AccountMenu current={current} onSelect={noop} />);
}

function renderShell(props: {
  section: Parameters<typeof AccountShell>[0]["section"];
  wide: boolean;
}) {
  return renderToStaticMarkup(
    <AccountShell section={props.section} wide={props.wide} onSelect={noop} onBack={noop}>
      <p>section body</p>
    </AccountShell>,
  );
}

describe("AccountMenu", () => {
  test("is one labelled nav holding a list of five rows", () => {
    const out = renderMenu("membership");
    expect(out).toContain('<nav aria-label="Account sections"');
    expect(out.match(/<ul[\s>]/g)?.length).toBe(1);
    expect(out.match(/<li[\s>]/g)?.length).toBe(5);
    expect(out.match(/<button[\s>]/g)?.length).toBe(5);
  });

  test("never scrolls sideways: no horizontal overflow utilities and no row-direction strip", () => {
    for (const current of ["membership", "security", null] as const) {
      const out = renderMenu(current);
      expect(out).not.toMatch(/overflow-x-(auto|scroll)/);
      expect(out).not.toContain("snap-x");
      expect(out).not.toMatch(/(^|[\s"])flex-row(\s|")/);
    }
  });

  test("each row is icon + label + chevron and at least 44px tall", () => {
    const out = renderMenu(null);
    const buttons = out.match(/<button[\s\S]*?<\/button>/g) ?? [];
    expect(buttons).toHaveLength(ACCOUNT_SECTIONS.length);
    ACCOUNT_SECTIONS.forEach((section, index) => {
      const row = buttons[index];
      expect(row).toContain(section.label.replace("&", "&amp;"));
      // leading icon + trailing chevron, both hidden from assistive tech
      expect(row.match(/<svg[^>]*aria-hidden="true"/g)?.length).toBe(2);
      expect(row).toMatch(/min-h-1[12]/);
    });
  });

  test("marks only the active row with aria-current", () => {
    const out = renderMenu("security");
    expect(out.match(/aria-current="page"/g)?.length).toBe(1);
    const buttons = out.match(/<button[\s\S]*?<\/button>/g) ?? [];
    const current = buttons.find((b) => b.includes('aria-current="page"'));
    expect(current).toContain("Email &amp; Security");
  });

  test("marks nothing current when no section is open", () => {
    expect(renderMenu(null)).not.toContain("aria-current");
  });

  test("every section that existed before the re-layout is still listed, in order", () => {
    expect(ACCOUNT_SECTIONS.map((s) => [s.id, s.label])).toEqual([
      ["membership", "Membership"],
      ["preferences", "Preferences"],
      ["location", "Default Location"],
      ["security", "Email & Security"],
      ["privacy", "Privacy & Data"],
    ]);
  });

  test("rows are real buttons that do not submit a form", () => {
    const out = renderMenu(null);
    expect(out.match(/type="button"/g)?.length).toBe(5);
  });

  test("copy has no em or en dashes", () => {
    for (const section of ACCOUNT_SECTIONS) {
      expect(section.label).not.toMatch(/[–—]/);
    }
  });
});

describe("AccountShell", () => {
  test("phone with no section open shows the menu and hides the detail panel", () => {
    const out = renderShell({ section: null, wide: false });
    const [before, after] = out.split("data-account-detail");
    expect(before).not.toContain("max-lg:hidden");
    expect(after).toContain("max-lg:hidden");
    expect(out).not.toContain('aria-current="page"');
  });

  test("phone with a section open hides the menu and offers a visible way back", () => {
    const out = renderShell({ section: "security", wide: false });
    expect(out).toContain("data-account-menu");
    const menuTag = out.match(/<div[^>]*data-account-menu[^>]*>/)?.[0] ?? "";
    expect(menuTag).toContain("max-lg:hidden");
    expect(out).toContain("section body");
    // back is a text + icon button, not an icon alone
    const back = out.match(/<button[^>]*data-account-back[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(back).toMatch(/Back to account/i);
    expect(back).toContain("<svg");
    expect(back).toMatch(/min-h-11/);
    // the detail heading names the open section
    expect(out).toMatch(/<h2[^>]*>Email &amp; Security<\/h2>/);
  });

  test("the back control and heading are phone/tablet only", () => {
    const out = renderShell({ section: "privacy", wide: false });
    const back = out.match(/<button[^>]*data-account-back[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(back).toContain("lg:hidden");
  });

  test("wide with no pick highlights Membership and shows its content next to the list", () => {
    const out = renderShell({ section: null, wide: true });
    expect(out.match(/aria-current="page"/g)?.length).toBe(1);
    const buttons = out.match(/<button[\s\S]*?<\/button>/g) ?? [];
    expect(buttons.find((b) => b.includes('aria-current="page"'))).toContain("Membership");
    expect(out).toContain("section body");
  });

  test("never introduces horizontal scrolling and lets the content column shrink", () => {
    for (const section of [null, "membership", "security"] as const) {
      const out = renderShell({ section, wide: false });
      expect(out).not.toMatch(/overflow-x-(auto|scroll)/);
      expect(out).toMatch(/data-account-detail[^>]*class="[^"]*min-w-0/);
    }
  });
});
