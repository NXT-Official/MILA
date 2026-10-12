import { useEffect, useRef } from "react";

type Hooks = { useRef: typeof useRef; useEffect: typeof useEffect };

/**
 * A ref that always holds the latest `value` and is `null` once the component
 * has unmounted. For async work that settles later and must read where she is
 * now, not where she was when it started: after she leaves the page entirely
 * the ref is null, so a late result cannot navigate her back or touch state
 * that no longer exists.
 *
 * The cleanup is part of the effect that writes the value, so a re-run of the
 * effect (a new value, or React StrictMode's remount) puts the value back.
 * `hooks` exists only so a test can drive the effect and its cleanup by hand.
 */
export function useLiveValue<T>(value: T, hooks: Hooks = { useRef, useEffect }) {
  const ref = hooks.useRef<T | null>(value);
  hooks.useEffect(() => {
    ref.current = value;
    return () => {
      ref.current = null;
    };
  }, [value]);
  return ref;
}
