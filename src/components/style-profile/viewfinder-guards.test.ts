import { describe, expect, test } from "bun:test";
import { PERMISSION_HINT_DELAY_MS } from "@/lib/camera-errors";
import { armPermissionHint, createLayerEscapeGuard } from "./viewfinder-guards";

/** A deferral the test runs by hand: "the keydown that closed the layer is over". */
function manualDefer() {
  const queued: Array<() => void> = [];
  return {
    defer: (fn: () => void) => void queued.push(fn),
    flush: () => {
      for (const fn of queued.splice(0)) fn();
    },
  };
}

describe("createLayerEscapeGuard", () => {
  test("Esc closes the camera while no dialog sits on top of it", () => {
    const guard = createLayerEscapeGuard(manualDefer().defer);
    expect(guard.escapeCloses()).toBe(true);
  });

  test("Esc never closes the camera while the out-of-credits dialog is open", () => {
    const guard = createLayerEscapeGuard(manualDefer().defer);
    guard.setOpen("paywall", true);
    expect(guard.escapeCloses()).toBe(false);
  });

  // Radix closes its dialog on the same keydown, before the camera's own Esc
  // handler runs: the dialog still counts as open until that keydown is over.
  test("the Esc that closed the dialog does not also close the camera", () => {
    const { defer, flush } = manualDefer();
    const guard = createLayerEscapeGuard(defer);
    guard.setOpen("paywall", true);
    guard.setOpen("paywall", false);
    expect(guard.escapeCloses()).toBe(false);
    flush();
    expect(guard.escapeCloses()).toBe(true);
  });

  test("a dialog opened again before the old close lands stays open", () => {
    const { defer, flush } = manualDefer();
    const guard = createLayerEscapeGuard(defer);
    guard.setOpen("paywall", true);
    guard.setOpen("paywall", false);
    guard.setOpen("paywall", true);
    flush();
    expect(guard.escapeCloses()).toBe(false);
  });

  test("each layer counts on its own (the paywall and the season sheet)", () => {
    const { defer, flush } = manualDefer();
    const guard = createLayerEscapeGuard(defer);
    guard.setOpen("paywall", true);
    guard.setOpen("season-sheet", true);
    guard.setOpen("paywall", false);
    flush();
    expect(guard.escapeCloses()).toBe(false);
    guard.setOpen("season-sheet", false);
    flush();
    expect(guard.escapeCloses()).toBe(true);
  });
});

describe("armPermissionHint", () => {
  function recordingSchedule() {
    const scheduled: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
    return {
      scheduled,
      schedule: (fn: () => void, ms: number) => {
        const entry = { fn, ms, cancelled: false };
        scheduled.push(entry);
        return () => {
          entry.cancelled = true;
        };
      },
    };
  }

  test("the first camera prompt gets the hint after its delay", () => {
    const { scheduled, schedule } = recordingSchedule();
    const shown: boolean[] = [];
    armPermissionHint({ granted: false, show: (v) => shown.push(v), schedule });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].ms).toBe(PERMISSION_HINT_DELAY_MS);
    scheduled[0].fn();
    expect(shown).toEqual([true]);
  });

  test("switching cameras after permission was granted never shows the permission hint", () => {
    const { scheduled, schedule } = recordingSchedule();
    const shown: boolean[] = [];
    const cancel = armPermissionHint({ granted: true, show: (v) => shown.push(v), schedule });
    expect(scheduled).toHaveLength(0);
    cancel();
    expect(shown).toEqual([]);
  });

  test("an answered prompt cancels the hint", () => {
    const { scheduled, schedule } = recordingSchedule();
    const cancel = armPermissionHint({ granted: false, show: () => {}, schedule });
    cancel();
    expect(scheduled[0].cancelled).toBe(true);
  });
});
