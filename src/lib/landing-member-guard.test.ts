import { describe, expect, test } from "bun:test";
import {
  AUTH_SETTLED_ATTR,
  markAuthSettled,
  MEMBER_ARRIVING_ATTR,
  MEMBER_ARRIVING_SCRIPT,
  MEMBER_ARRIVING_STYLE,
  clearMemberArriving,
  detectMemberArriving,
} from "./landing-member-guard";

type FakeWindow = Parameters<typeof detectMemberArriving>[0];

function fakeWindow({
  storage = {},
  search = "",
  hash = "",
  storageThrows = false,
}: {
  storage?: Record<string, string>;
  search?: string;
  hash?: string;
  storageThrows?: boolean;
}) {
  const attrs = new Map<string, string>();
  const keys = Object.keys(storage);
  const localStorage = {
    get length() {
      if (storageThrows) throw new Error("SecurityError");
      return keys.length;
    },
    key: (i: number) => keys[i] ?? null,
    getItem: (k: string) => storage[k] ?? null,
  };
  const win = {
    get localStorage() {
      if (storageThrows) throw new Error("SecurityError");
      return localStorage;
    },
    location: { search, hash },
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) => attrs.set(name, value),
        removeAttribute: (name: string) => attrs.delete(name),
      },
    },
  };
  return { win: win as unknown as FakeWindow, attrs };
}

const SESSION = JSON.stringify({
  access_token: "a.b.c",
  refresh_token: "rt-1",
  expires_at: 1_900_000_000,
  user: { id: "u1" },
});

describe("detectMemberArriving (runs before the landing paints)", () => {
  test("marks the page when this browser holds a session", () => {
    const { win, attrs } = fakeWindow({ storage: { "sb-abcd-auth-token": SESSION } });
    detectMemberArriving(win);
    expect(attrs.has(MEMBER_ARRIVING_ATTR)).toBe(true);
  });

  test("leaves a visitor's landing alone", () => {
    const { win, attrs } = fakeWindow({ storage: { "mila-theme": "dark" } });
    detectMemberArriving(win);
    expect(attrs.has(MEMBER_ARRIVING_ATTR)).toBe(false);
  });

  test("ignores a stored value that is not a session", () => {
    for (const value of ["not json", "null", "{}", JSON.stringify({ refresh_token: "" })]) {
      const { win, attrs } = fakeWindow({ storage: { "sb-abcd-auth-token": value } });
      detectMemberArriving(win);
      expect(attrs.has(MEMBER_ARRIVING_ATTR)).toBe(false);
    }
  });

  test("ignores the code-verifier and user side keys on their own", () => {
    const { win, attrs } = fakeWindow({
      storage: { "sb-abcd-auth-token-code-verifier": "v", "sb-abcd-auth-token-user": SESSION },
    });
    detectMemberArriving(win);
    expect(attrs.has(MEMBER_ARRIVING_ATTR)).toBe(false);
  });

  test("marks a sign-in callback landing here with a PKCE code", () => {
    const { win, attrs } = fakeWindow({
      storage: { "sb-abcd-auth-token-code-verifier": "v" },
      search: "?code=abc123",
    });
    detectMemberArriving(win);
    expect(attrs.has(MEMBER_ARRIVING_ATTR)).toBe(true);
  });

  test("a stray ?code= without a sign-in in progress is just a visitor", () => {
    const { win, attrs } = fakeWindow({ search: "?code=abc123" });
    detectMemberArriving(win);
    expect(attrs.has(MEMBER_ARRIVING_ATTR)).toBe(false);
  });

  test("marks an email-link sign-in arriving with tokens in the hash", () => {
    const { win, attrs } = fakeWindow({ hash: "#access_token=x&refresh_token=y&type=signup" });
    detectMemberArriving(win);
    expect(attrs.has(MEMBER_ARRIVING_ATTR)).toBe(true);
  });

  test("never throws when storage is blocked", () => {
    const { win, attrs } = fakeWindow({ storageThrows: true });
    expect(() => detectMemberArriving(win)).not.toThrow();
    expect(attrs.has(MEMBER_ARRIVING_ATTR)).toBe(false);
  });
});

describe("MEMBER_ARRIVING_SCRIPT", () => {
  test("is a self-contained inline script that runs the same check", () => {
    const { win, attrs } = fakeWindow({ storage: { "sb-abcd-auth-token": SESSION } });
    new Function("window", MEMBER_ARRIVING_SCRIPT)(win);
    expect(attrs.has(MEMBER_ARRIVING_ATTR)).toBe(true);
  });

  test("does nothing for a visitor", () => {
    const { win, attrs } = fakeWindow({});
    new Function("window", MEMBER_ARRIVING_SCRIPT)(win);
    expect(attrs.has(MEMBER_ARRIVING_ATTR)).toBe(false);
  });
});

describe("MEMBER_ARRIVING_STYLE", () => {
  test("hides only the landing, and only for an arriving member whose auth has not settled", () => {
    expect(MEMBER_ARRIVING_STYLE).toContain(
      `html[${MEMBER_ARRIVING_ATTR}]:not([${AUTH_SETTLED_ATTR}]) [data-landing-root]`,
    );
    expect(MEMBER_ARRIVING_STYLE).toContain(
      `html:not([${MEMBER_ARRIVING_ATTR}]) [data-member-splash]`,
    );
  });

  test("once the app knows she is signed out or reconnecting, a re-run head script cannot hide the landing", () => {
    expect(MEMBER_ARRIVING_STYLE).toContain(`html[${AUTH_SETTLED_ATTR}] [data-member-splash]`);
    expect(MEMBER_ARRIVING_STYLE).not.toContain(
      `html[${MEMBER_ARRIVING_ATTR}] [data-landing-root]`,
    );
  });

  test("reveals the landing by itself if the app never takes over", () => {
    expect(MEMBER_ARRIVING_STYLE).toMatch(/animation:[^;}]*forwards/);
    expect(MEMBER_ARRIVING_STYLE).toMatch(/@keyframes [\w-]+\{to\{visibility:visible\}\}/);
  });

  test("and takes the splash away at the same moment, so it never covers the landing", () => {
    expect(MEMBER_ARRIVING_STYLE).toMatch(
      /html\[data-member-arriving\]:not\(\[data-auth-settled\]\) \[data-member-splash\]\{animation:[\w-]+ 0s linear 10s forwards\}/,
    );
    expect(MEMBER_ARRIVING_STYLE).toMatch(/@keyframes [\w-]+\{to\{visibility:hidden\}\}/);
  });
});

describe("markAuthSettled", () => {
  function fakeDoc() {
    const attrs = new Set<string>();
    return {
      attrs,
      doc: {
        documentElement: {
          setAttribute: (name: string) => attrs.add(name),
          removeAttribute: (name: string) => attrs.delete(name),
        },
      },
    };
  }

  test("signed out or reconnecting: settled, the landing is the right page", () => {
    for (const status of ["signed-out", "reconnecting"] as const) {
      const { attrs, doc } = fakeDoc();
      markAuthSettled(status, doc);
      expect(attrs.has(AUTH_SETTLED_ATTR)).toBe(true);
    }
  });

  test("loading or signed in: not settled, the pre-paint mark keeps working", () => {
    for (const status of ["loading", "signed-in"] as const) {
      const { attrs, doc } = fakeDoc();
      attrs.add(AUTH_SETTLED_ATTR);
      markAuthSettled(status, doc);
      expect(attrs.has(AUTH_SETTLED_ATTR)).toBe(false);
    }
  });
});

describe("clearMemberArriving", () => {
  test("shows the landing again", () => {
    const { win, attrs } = fakeWindow({ storage: { "sb-abcd-auth-token": SESSION } });
    detectMemberArriving(win);
    clearMemberArriving(win.document);
    expect(attrs.has(MEMBER_ARRIVING_ATTR)).toBe(false);
  });
});

describe("the home route ships the guard in its <head>", () => {
  test("inline script and style ride with the landing's loader data", async () => {
    const { Route: HomeRoute } = await import("@/routes/index");
    const { LANDING_FALLBACK } = await import("@/lib/landing-content.fallback");
    type HomeHead = NonNullable<typeof HomeRoute.options.head>;
    const head = await (HomeRoute.options.head as HomeHead)({
      loaderData: LANDING_FALLBACK,
    } as Parameters<HomeHead>[0]);
    expect(head.scripts).toEqual([{ children: MEMBER_ARRIVING_SCRIPT }]);
    expect(head.styles).toEqual([{ children: MEMBER_ARRIVING_STYLE }]);
  });
});
