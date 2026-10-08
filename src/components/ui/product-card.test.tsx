import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductCard } from "./product-card";

// loading="lazy" like every real caller; an eager <img src> makes React 19
// hoist a <link rel="preload"> ahead of the markup under test.
const image = <img src="https://example.com/p.jpg" alt="A linen shirt" loading="lazy" />;

describe("ProductCard", () => {
  test("as a link it still wraps the image and body in one anchor", () => {
    const out = renderToStaticMarkup(
      <ProductCard as="a" href="https://shop.example.com/p" image={image}>
        <p>Linen shirt</p>
      </ProductCard>,
    );
    expect(out).toStartWith("<a ");
    expect(out).toContain('href="https://shop.example.com/p"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer sponsored"');
    expect(out).toContain('alt="A linen shirt"');
    expect(out).toContain("<p>Linen shirt</p>");
  });

  test("as a div it renders without a link", () => {
    const out = renderToStaticMarkup(
      <ProductCard image={image}>
        <p>Linen shirt</p>
      </ProductCard>,
    );
    expect(out).toStartWith("<div");
    expect(out).not.toContain("<a ");
  });

  test("the overlay lands inside the image box", () => {
    const out = renderToStaticMarkup(
      <ProductCard as="a" href="https://shop.example.com/p" image={image} overlay={<i>badge</i>}>
        <p>Linen shirt</p>
      </ProductCard>,
    );
    const imageBox = out.slice(out.indexOf("aspect-3/4"), out.indexOf("<p>Linen shirt</p>"));
    expect(imageBox).toContain("<i>badge</i>");
  });

  test("actions sit outside the link so a button is never nested in an anchor", () => {
    const out = renderToStaticMarkup(
      <ProductCard
        as="a"
        href="https://shop.example.com/p"
        image={image}
        actions={<button type="button">Save</button>}
      >
        <p>Linen shirt</p>
      </ProductCard>,
    );
    const anchor = out.slice(out.indexOf("<a "), out.indexOf("</a>") + 4);
    expect(anchor).not.toContain("<button");
    expect(out).toContain('<button type="button">Save</button>');
    expect(out.indexOf("<button")).toBeGreaterThan(out.indexOf("</a>"));
    // The wrapper is the positioning context for the top-right actions.
    expect(out).toStartWith('<div class="relative');
  });

  test("the className still styles the card itself when actions are present", () => {
    const out = renderToStaticMarkup(
      <ProductCard
        as="a"
        href="https://shop.example.com/p"
        image={image}
        className="h-full"
        actions={<button type="button">Save</button>}
      >
        <p>Linen shirt</p>
      </ProductCard>,
    );
    const anchorTag = out.slice(out.indexOf("<a "), out.indexOf(">", out.indexOf("<a ")) + 1);
    expect(anchorTag).toContain("h-full");
    expect(anchorTag).toContain("atelier-focus-ring");
  });
});
