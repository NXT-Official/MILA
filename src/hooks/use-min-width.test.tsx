import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { minWidthQuery, minWidthStore, useMinWidth } from "./use-min-width";

type Listener = () => void;

function stubMatchMedia(initial: boolean) {
  const state = { matches: initial, listeners: new Set<Listener>(), queries: [] as string[] };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      matchMedia: (query: string) => {
        state.queries.push(query);
        return {
          get matches() {
            return state.matches;
          },
          addEventListener: (_: string, fn: Listener) => state.listeners.add(fn),
          removeEventListener: (_: string, fn: Listener) => state.listeners.delete(fn),
        };
      },
    },
  });
  return state;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("minWidthQuery", () => {
  test("builds a CSS length media query, so it can match Tailwind's rem breakpoints", () => {
    expect(minWidthQuery("64rem")).toBe("(min-width: 64rem)");
    expect(minWidthQuery("1024px")).toBe("(min-width: 1024px)");
  });
});

describe("minWidthStore", () => {
  test("is the same object for the same length, so subscribe never changes between renders", () => {
    expect(minWidthStore("64rem")).toBe(minWidthStore("64rem"));
    expect(minWidthStore("64rem").subscribe).toBe(minWidthStore("64rem").subscribe);
    expect(minWidthStore("48rem")).not.toBe(minWidthStore("64rem"));
  });

  test("reads the current match and listens for changes on the 64rem query", () => {
    const media = stubMatchMedia(true);
    const store = minWidthStore("64rem");
    expect(store.getSnapshot()).toBe(true);
    expect(media.queries).toContain("(min-width: 64rem)");

    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    expect(media.listeners.size).toBe(1);
    media.listeners.forEach((fn) => fn());
    expect(calls).toBe(1);

    unsubscribe();
    expect(media.listeners.size).toBe(0);
  });

  test("reflects a viewport that stops matching", () => {
    const media = stubMatchMedia(true);
    const store = minWidthStore("64rem");
    expect(store.getSnapshot()).toBe(true);
    media.matches = false;
    expect(store.getSnapshot()).toBe(false);
  });

  test("without matchMedia it reports narrow and never throws", () => {
    const store = minWidthStore("64rem");
    expect(store.getSnapshot()).toBe(false);
    expect(() => store.subscribe(() => {})()).not.toThrow();
  });
});

describe("useMinWidth", () => {
  function Probe() {
    return <p>{useMinWidth("64rem") ? "wide" : "narrow"}</p>;
  }

  test("renders the narrow layout on the server and during hydration", () => {
    stubMatchMedia(true);
    expect(renderToStaticMarkup(<Probe />)).toBe("<p>narrow</p>");
  });
});
