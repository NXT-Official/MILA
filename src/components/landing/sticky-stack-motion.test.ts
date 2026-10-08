import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  STACK_DESKTOP_QUERY,
  STACK_MOTION_ATTR,
  STACK_MOTION_QUERY,
  STACK_REDUCE_QUERY,
  mountStackMotion,
  stackMotionAllowed,
  startStackMotion,
  type StackMotionLib,
} from "./sticky-stack-motion";

type Vars = Record<string, unknown>;

/** A media-query answer for each query the stack asks about. */
function media({ desktop, reduce }: { desktop: boolean; reduce: boolean }) {
  const asked: string[] = [];
  const matchMedia = (query: string) => {
    asked.push(query);
    if (query === STACK_DESKTOP_QUERY) return { matches: desktop };
    if (query === STACK_REDUCE_QUERY) return { matches: reduce };
    throw new Error(`unexpected media query ${query}`);
  };
  return { matchMedia, asked };
}

/**
 * A stand-in root element that records the attributes motion sets on it. With
 * `page`, it sits in a document whose sticky header and viewport have those
 * heights; without, there is no header and no viewport to measure.
 */
function fakeRoot(page?: { header: number; viewport: number }) {
  const attrs = new Map<string, string>();
  const refreshed = { count: 0 };
  const ownerDocument = page && {
    querySelector: (selector: string) =>
      selector === "header" ? { getBoundingClientRect: () => ({ height: page.header }) } : null,
    defaultView: { innerHeight: page.viewport },
    fonts: { ready: Promise.resolve() },
  };
  const root = {
    ownerDocument,
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
    removeAttribute: (name: string) => void attrs.delete(name),
  };
  return { root: root as unknown as HTMLElement, attrs, refreshed };
}

/** A start or end position as ScrollTrigger reads it: a string, or a function giving one. */
function at(position: unknown) {
  return typeof position === "function" ? (position as () => string)() : position;
}

/** A stand-in for GSAP and ScrollTrigger that records what the stack asks of them. */
function fakeLib(panelCount: number, panelHeight = 400) {
  const cards = Array.from({ length: panelCount }, (_, i) => ({ card: i }));
  const panels = cards.map((card, i) => ({
    panel: i,
    offsetHeight: panelHeight,
    querySelector: (selector: string) => (selector === "[data-stack-card]" ? card : null),
  }));
  const pins: Vars[] = [];
  const tweens: { target: unknown; vars: Vars }[] = [];
  const state = {
    query: "",
    scope: undefined as unknown,
    reverted: 0,
    selector: "",
    refreshes: 0,
  };
  let cleanup: (() => void) | void;
  const gsap = {
    matchMedia: (scope: unknown) => {
      state.scope = scope;
      const mm = {
        add: (query: string, fn: () => (() => void) | void) => {
          state.query = query;
          cleanup = fn();
          return mm;
        },
        revert: () => {
          state.reverted += 1;
          if (cleanup) cleanup();
        },
      };
      return mm;
    },
    to: (target: unknown, vars: Vars) => void tweens.push({ target, vars }),
    utils: {
      toArray: (selector: string) => {
        state.selector = selector;
        return panels;
      },
    },
  };
  const ScrollTrigger = {
    create: (vars: Vars) => void pins.push(vars),
    refresh: () => void (state.refreshes += 1),
  };
  const lib = { gsap, ScrollTrigger } as unknown as StackMotionLib;
  return { lib, panels, cards, pins, tweens, state };
}

describe("stackMotionAllowed", () => {
  test("a wide screen with motion allowed gets the pinned stack", () => {
    expect(stackMotionAllowed(media({ desktop: true, reduce: false }).matchMedia)).toBe(true);
  });

  test("reduced motion keeps the panels static", () => {
    expect(stackMotionAllowed(media({ desktop: true, reduce: true }).matchMedia)).toBe(false);
  });

  test("a narrow screen keeps the panels static", () => {
    expect(stackMotionAllowed(media({ desktop: false, reduce: false }).matchMedia)).toBe(false);
  });
});

describe("startStackMotion", () => {
  test("pins every panel but the last just under the site header until the last arrives", () => {
    const { root } = fakeRoot({ header: 65, viewport: 900 });
    const { lib, panels, pins, state } = fakeLib(3);
    startStackMotion(root, lib);

    expect(state.query).toBe(STACK_MOTION_QUERY);
    expect(state.scope).toBe(root);
    expect(state.selector).toBe("[data-stack-panel]");
    expect(
      pins.map(({ start, end, ...rest }) => ({ ...rest, start: at(start), end: at(end) })),
    ).toEqual(
      panels.slice(0, -1).map((panel) => ({
        trigger: panel,
        start: "top 81px",
        endTrigger: panels[2],
        end: "top 81px",
        pin: true,
        pinSpacing: false,
      })),
    );
  });

  test("without a header the pin sits 16px from the viewport top", () => {
    const { root } = fakeRoot();
    const { lib, pins } = fakeLib(3);
    startStackMotion(root, lib);
    expect(pins.map((pin) => at(pin.start))).toEqual(["top 16px", "top 16px"]);
  });

  test("a pinned card fades out only while the next one slides over it, so two fading cards never overlap", () => {
    const { root } = fakeRoot({ header: 65, viewport: 900 });
    const { lib, panels, cards, tweens } = fakeLib(3, 400);
    startStackMotion(root, lib);

    expect(tweens.map((t) => t.target)).toEqual(cards.slice(0, -1));
    tweens.forEach(({ vars }, i) => {
      const { scrollTrigger, ease, ...props } = vars;
      // Transform and opacity only; the bottom edge holds still, so the next
      // card's top never leaves a gap under it.
      expect(props).toEqual({ scale: 0.94, autoAlpha: 0, transformOrigin: "50% 100%" });
      expect(ease).toBe("none");
      const { start, end, ...trigger } = scrollTrigger as Vars;
      expect(trigger).toEqual({ trigger: panels[i + 1], scrub: true });
      // From the moment the next card touches this card's bottom (81 + 400)
      // to the moment it is pinned in this card's place.
      expect(at(start)).toBe("top 481px");
      expect(at(end)).toBe("top 81px");
    });
  });

  test("a card taller than the room under the header is never pinned: its bottom would be out of reach", () => {
    const { root, attrs } = fakeRoot({ header: 65, viewport: 600 });
    const { lib, pins, tweens } = fakeLib(3, 560);
    startStackMotion(root, lib);
    expect(pins).toEqual([]);
    expect(tweens).toEqual([]);
    expect(attrs.has(STACK_MOTION_ATTR)).toBe(false);
  });

  test("once the web fonts settle, the pin positions are measured again", async () => {
    const { root } = fakeRoot({ header: 65, viewport: 900 });
    const { lib, state } = fakeLib(3);
    startStackMotion(root, lib);
    expect(state.refreshes).toBe(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.refreshes).toBe(1);
  });

  test("a single panel is never pinned", () => {
    const { root } = fakeRoot();
    const { lib, pins, tweens } = fakeLib(1);
    startStackMotion(root, lib);
    expect(pins).toEqual([]);
    expect(tweens).toEqual([]);
  });

  test("marks the root while pinned and the cleanup reverts every pin and mark", () => {
    const { root, attrs } = fakeRoot();
    const { lib, state } = fakeLib(3);
    const stop = startStackMotion(root, lib);
    expect(attrs.get(STACK_MOTION_ATTR)).toBe("on");

    stop();
    expect(state.reverted).toBe(1);
    expect(attrs.has(STACK_MOTION_ATTR)).toBe(false);
  });
});

describe("mountStackMotion", () => {
  test("under reduced motion GSAP is never loaded and the panels are left as rendered", () => {
    const { root, attrs } = fakeRoot();
    let loads = 0;
    const stop = mountStackMotion(root, {
      matchMedia: media({ desktop: true, reduce: true }).matchMedia,
      load: async () => {
        loads += 1;
        return fakeLib(3).lib;
      },
    });
    stop();
    expect(loads).toBe(0);
    expect(attrs.size).toBe(0);
  });

  test("on a narrow screen GSAP is never loaded", () => {
    const { root } = fakeRoot();
    let loads = 0;
    mountStackMotion(root, {
      matchMedia: media({ desktop: false, reduce: false }).matchMedia,
      load: async () => {
        loads += 1;
        return fakeLib(3).lib;
      },
    });
    expect(loads).toBe(0);
  });

  test("with motion allowed it loads GSAP once, starts the stack, and stops it on unmount", async () => {
    const { root } = fakeRoot();
    const { lib } = fakeLib(3);
    const started: unknown[] = [];
    let stopped = 0;
    const stop = mountStackMotion(root, {
      matchMedia: media({ desktop: true, reduce: false }).matchMedia,
      load: async () => lib,
      start: (el, loaded) => {
        started.push([el, loaded]);
        return () => void (stopped += 1);
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([[root, lib]]);

    stop();
    expect(stopped).toBe(1);
  });

  test("unmounting before GSAP arrives never starts the stack", async () => {
    const { root } = fakeRoot();
    const { lib } = fakeLib(3);
    let release: (value: StackMotionLib) => void = () => {};
    const pending = new Promise<StackMotionLib>((resolve) => (release = resolve));
    let starts = 0;
    const stop = mountStackMotion(root, {
      matchMedia: media({ desktop: true, reduce: false }).matchMedia,
      load: () => pending,
      start: () => {
        starts += 1;
        return () => {};
      },
    });
    stop();
    release(lib);
    await pending;
    await Promise.resolve();
    expect(starts).toBe(0);
  });

  test("a failed load leaves the static panels and throws nothing", async () => {
    const { root, attrs } = fakeRoot();
    const failing = Promise.reject(new Error("chunk failed"));
    const stop = mountStackMotion(root, {
      matchMedia: media({ desktop: true, reduce: false }).matchMedia,
      load: () => failing,
    });
    await failing.catch(() => {});
    await Promise.resolve();
    expect(attrs.size).toBe(0);
    expect(() => stop()).not.toThrow();
  });
});

describe("GSAP stays out of the server render", () => {
  // TanStack Start renders the landing on the server: GSAP may only arrive by a
  // dynamic import inside an effect, never as a static import of these modules.
  test.each(["sticky-stack-motion.ts", "style-flow-stack.tsx"])(
    "%s has no static GSAP import",
    (file) => {
      const source = readFileSync(join(import.meta.dir, file), "utf8");
      expect(source).not.toMatch(/^\s*import\s+(?!type\b)[^;]*from\s+["']gsap/m);
    },
  );
});
