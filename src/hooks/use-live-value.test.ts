import { describe, expect, test } from "bun:test";
import { useLiveValue } from "./use-live-value";

type Cleanup = void | (() => void);

/** Stand-ins for useRef/useEffect that let a test run an effect and its cleanup by hand. */
function fakeHooks() {
  const effects: Array<() => Cleanup> = [];
  const hooks = {
    useRef: <T>(initial: T) => ({ current: initial }),
    useEffect: (effect: () => Cleanup) => {
      effects.push(effect);
    },
  };
  return { hooks, effects };
}

describe("useLiveValue", () => {
  test("starts at the value it was given", () => {
    const { hooks } = fakeHooks();
    expect(useLiveValue("location", hooks as never).current).toBe("location");
  });

  test("a later render's value is written through by its effect", () => {
    // one component across two renders: the ref persists, the effect is new
    const { hooks, effects } = fakeHooks();
    const shared = { current: "location" as string | null };
    const sharedHooks = { ...hooks, useRef: () => shared };
    useLiveValue<string | null>("location", sharedHooks as never);
    useLiveValue<string | null>("preferences", sharedHooks as never);
    effects[1]();
    expect(shared.current).toBe("preferences");
  });

  test("is cleared when the component unmounts, so a late async result sees she has left", () => {
    const { hooks, effects } = fakeHooks();
    const ref = useLiveValue<string | null>("location", hooks as never);
    const cleanup = effects[0]();
    expect(ref.current).toBe("location");
    expect(typeof cleanup).toBe("function");
    if (typeof cleanup === "function") cleanup();
    expect(ref.current).toBeNull();
  });

  test("a re-run of the effect (new value, or StrictMode's remount) restores the value", () => {
    const { hooks, effects } = fakeHooks();
    const ref = useLiveValue<string | null>("location", hooks as never);
    const cleanup = effects[0]();
    if (typeof cleanup === "function") cleanup();
    expect(ref.current).toBeNull();
    effects[0]();
    expect(ref.current).toBe("location");
  });
});
