import { expect, test } from "bun:test";
import { container, item, slide } from "./motion";

test("reduced motion collapses the stagger and the offset", () => {
  expect((container(false, 0.09).visible as any).transition.staggerChildren).toBe(0.09);
  expect((container(true, 0.09).visible as any).transition.staggerChildren).toBe(0);
  expect((item(false, 18, 0.5).hidden as any).y).toBe(18);
  expect((item(true, 18, 0.5).hidden as any).y).toBe(0);
  expect((slide(true).enter as any)(1).x).toBe(0);
});

test("slide travels with the step direction: in from ahead, out the way it came", () => {
  const s = slide(false, 24);
  expect((s.enter as any)(1).x).toBe(24); // forward: enters from the right
  expect((s.exit as any)(1).x).toBe(-24); // ...pushing the old step left
  expect((s.enter as any)(-1).x).toBe(-24); // back: mirrored
  expect((s.exit as any)(-1).x).toBe(24);
});
