import { expect, test } from "bun:test";
import { container, item } from "./motion";

test("reduced motion collapses the stagger and the offset", () => {
  expect((container(false, 0.09).visible as any).transition.staggerChildren).toBe(0.09);
  expect((container(true, 0.09).visible as any).transition.staggerChildren).toBe(0);
  expect((item(false, 18, 0.5).hidden as any).y).toBe(18);
  expect((item(true, 18, 0.5).hidden as any).y).toBe(0);
});
