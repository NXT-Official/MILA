import { describe, expect, test } from "bun:test";
import { notifyIfBackgrounded, shouldNotifyInBackground } from "./background-notify";

describe("shouldNotifyInBackground", () => {
  test("true only when supported, hidden, and granted all hold", () => {
    expect(
      shouldNotifyInBackground({
        documentHidden: true,
        notificationSupported: true,
        permission: "granted",
      }),
    ).toBe(true);
  });

  test("false when the tab is foregrounded — the existing toast covers that case", () => {
    expect(
      shouldNotifyInBackground({
        documentHidden: false,
        notificationSupported: true,
        permission: "granted",
      }),
    ).toBe(false);
  });

  test("false when permission was never granted", () => {
    expect(
      shouldNotifyInBackground({
        documentHidden: true,
        notificationSupported: true,
        permission: "default",
      }),
    ).toBe(false);
    expect(
      shouldNotifyInBackground({
        documentHidden: true,
        notificationSupported: true,
        permission: "denied",
      }),
    ).toBe(false);
  });

  test("false when the Notification API isn't supported", () => {
    expect(
      shouldNotifyInBackground({
        documentHidden: true,
        notificationSupported: false,
        permission: "granted",
      }),
    ).toBe(false);
  });
});

describe("notifyIfBackgrounded", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { Notification: g.Notification, document: g.document, navigator: g.navigator };
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete g[k];
      else Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
    }
  };
  const set = (k: string, v: unknown) =>
    Object.defineProperty(g, k, { value: v, configurable: true, writable: true });

  function throwingNotification() {
    const N = function () {
      throw new TypeError("Illegal constructor");
    } as unknown as { permission: string };
    N.permission = "granted";
    set("Notification", N);
    set("document", { hidden: true });
  }

  test("falls back to the service worker when the constructor throws", async () => {
    throwingNotification();
    const shown: unknown[][] = [];
    set("navigator", {
      serviceWorker: {
        getRegistration: () =>
          Promise.resolve({ showNotification: (...a: unknown[]) => shown.push(a) }),
      },
    });
    try {
      expect(() => notifyIfBackgrounded("Look ready", "body")).not.toThrow();
      await new Promise((r) => setTimeout(r, 0));
      expect(shown).toEqual([["Look ready", { body: "body" }]]);
    } finally {
      restore();
    }
  });

  test("skips silently when the constructor throws and no service worker exists", () => {
    throwingNotification();
    set("navigator", {});
    try {
      expect(() => notifyIfBackgrounded("Look ready")).not.toThrow();
    } finally {
      restore();
    }
  });

  test("shows nothing, even after a later registration, when no worker is registered", async () => {
    throwingNotification();
    const shown: unknown[][] = [];
    let register: (r: unknown) => void = () => undefined;
    const ready = new Promise((resolve) => {
      register = resolve;
    });
    set("navigator", {
      serviceWorker: { ready, getRegistration: () => Promise.resolve(undefined) },
    });
    try {
      notifyIfBackgrounded("Look ready");
      await new Promise((r) => setTimeout(r, 0));
      register({ showNotification: (...a: unknown[]) => shown.push(a) });
      await new Promise((r) => setTimeout(r, 0));
      expect(shown).toEqual([]);
    } finally {
      restore();
    }
  });

  test("a failing showNotification never rejects into the caller", async () => {
    throwingNotification();
    set("navigator", {
      serviceWorker: {
        getRegistration: () =>
          Promise.resolve({ showNotification: () => Promise.reject(new Error("no")) }),
      },
    });
    try {
      notifyIfBackgrounded("Look ready");
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      restore();
    }
  });
});
