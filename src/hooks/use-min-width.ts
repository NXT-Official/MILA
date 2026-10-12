import { useSyncExternalStore } from "react";

type Store = {
  subscribe: (notify: () => void) => () => void;
  getSnapshot: () => boolean;
};

/** A CSS length ("64rem", "1024px"); rem matches Tailwind's breakpoints (`lg` is 64rem). */
export function minWidthQuery(length: string): string {
  return `(min-width: ${length})`;
}

const stores = new Map<string, Store>();

/**
 * One store per length, created once. `useSyncExternalStore` resubscribes
 * whenever `subscribe` changes identity, so a function built inside the hook
 * would tear down and re-add its listener on every render.
 */
export function minWidthStore(length: string): Store {
  const cached = stores.get(length);
  if (cached) return cached;
  const query = minWidthQuery(length);
  const hasMatchMedia = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function";
  const store: Store = {
    subscribe: (notify) => {
      if (!hasMatchMedia()) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    getSnapshot: () => hasMatchMedia() && window.matchMedia(query).matches,
  };
  stores.set(length, store);
  return store;
}

/**
 * True while the viewport is at least `length` wide (e.g. "64rem", the same as
 * Tailwind's `lg:`). Layout should stay in CSS; use this only for state that
 * has to differ with the layout (an `aria-current` marker, a focus move). The
 * server snapshot is `false`, so hydration matches the narrow layout and
 * corrects itself right after.
 */
// src: https://react.dev/reference/react/useSyncExternalStore · react 19.2
// src: https://tailwindcss.com/docs/responsive-design (lg = 64rem) · tailwindcss 4.2
export function useMinWidth(length: string): boolean {
  const { subscribe, getSnapshot } = minWidthStore(length);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
