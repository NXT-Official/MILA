import { PERMISSION_HINT_DELAY_MS } from "@/lib/camera-errors";

/**
 * Esc belongs to the topmost layer. The viewfinder's own Esc (useModalA11y,
 * a document keydown listener) must not close the camera when the keydown was
 * meant for a dialog on top of it: the out-of-credits dialog or the season
 * sheet (B4 COLOUR-CLIENT).
 *
 * Radix closes its dialog on that same keydown, and React commits the closed
 * state before the camera's listener runs (a discrete update flushes in the
 * microtask between listeners). So a closed layer keeps counting as open
 * until `defer` runs, a macrotask after the keydown has finished: the Esc
 * that closed the dialog never also closes the camera.
 *
 * `useModalA11y` reads `onClose` once per mount, so passing `undefined` while
 * the dialog is open would not take effect; the camera passes one handler that
 * asks this guard instead.
 */
export function createLayerEscapeGuard(
  defer: (fn: () => void) => void = (fn) => {
    setTimeout(fn, 0);
  },
) {
  const open = new Set<string>();
  const generation = new Map<string, number>();
  return {
    setOpen(layer: string, isOpen: boolean): void {
      const current = (generation.get(layer) ?? 0) + 1;
      generation.set(layer, current);
      if (isOpen) {
        open.add(layer);
        return;
      }
      defer(() => {
        // Opened again meanwhile: that newer state stands.
        if (generation.get(layer) === current) open.delete(layer);
      });
    },
    /** True when Esc may close the camera: no layer is (or was this keydown) open. */
    escapeCloses(): boolean {
      return open.size === 0;
    },
  };
}

export type LayerEscapeGuard = ReturnType<typeof createLayerEscapeGuard>;

type Schedule = (fn: () => void, ms: number) => () => void;

const realSchedule: Schedule = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

/**
 * Arms the "allow camera access" hint for a browser prompt that may sit
 * unanswered. Once she has granted the camera, switching between the front
 * and back camera never arms it: a slow switch is not a prompt (B4
 * COLOUR-CLIENT). Answers the cancel, called when the prompt is answered.
 */
export function armPermissionHint(args: {
  granted: boolean;
  show: (visible: boolean) => void;
  schedule?: Schedule;
}): () => void {
  if (args.granted) return () => {};
  return (args.schedule ?? realSchedule)(() => args.show(true), PERMISSION_HINT_DELAY_MS);
}
