import { describe, expect, test, beforeEach } from "bun:test";
import { requestFirstLook, takeFirstLookHandoff } from "./first-look";

function stubSessionStorage() {
  const store = new Map<string, string>();
  (globalThis as any).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };
}

describe("first look handoff", () => {
  beforeEach(stubSessionStorage);

  test("fires once and only once — a second dashboard mount must not spend a credit", () => {
    requestFirstLook();
    expect(takeFirstLookHandoff()).toBe(true);
    expect(takeFirstLookHandoff()).toBe(false);
  });

  test("no handoff pending means no auto-generation", () => {
    expect(takeFirstLookHandoff()).toBe(false);
  });

  test("survives an environment with no storage at all", () => {
    delete (globalThis as any).sessionStorage;
    expect(() => requestFirstLook()).not.toThrow();
    expect(takeFirstLookHandoff()).toBe(false);
  });
});
