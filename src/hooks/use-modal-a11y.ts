import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null,
  );
}

interface UseModalA11yOptions {
  /** Ref to the modal's outermost DOM node. */
  containerRef: RefObject<HTMLElement | null>;
  /** Called when the user presses Escape. Pass `undefined` to disable. */
  onClose?: () => void;
  /**
   * Re-runs focus capture + trap setup whenever this value changes. Needed
   * for components that swap which DOM node `containerRef` points to across
   * renders (e.g. a multi-screen overlay that conditionally renders a
   * different root `<div>` per step) rather than mounting/unmounting the
   * whole component.
   */
  resetKey?: unknown;
}

/**
 * Minimal keyboard-accessibility layer for custom full-screen overlays that
 * don't go through Radix `Dialog` (which provides this automatically):
 * - Traps Tab/Shift+Tab focus within the container.
 * - Closes on Escape.
 * - Restores focus to the previously focused element on unmount.
 *
 * Intended for overlays that are conditionally mounted (`{open && <Modal />}`)
 * rather than toggled via an `open` prop — the effect runs for the lifetime
 * of the component (or re-runs when `resetKey` changes).
 */
export function useModalA11y({ containerRef, onClose, resetKey }: UseModalA11yOptions): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const [first] = getFocusableElements(container);
    (first ?? container).focus({ preventScroll: true });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && onClose) {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !container) return;
      const items = getFocusableElements(container);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- container/onClose intentionally captured once per mount (or per resetKey change); overlay is remounted (not re-opened) by parent's conditional render
  }, [resetKey]);
}
