import type { Variants } from "framer-motion";

// ponytail: one entrance pattern for every page — container fades its children in sequence.
// Reduced motion collapses the stagger and the offset instead of dropping the mount animation.
export const container = (reduce: boolean, stagger: number): Variants => ({
  hidden: { opacity: 1 },
  visible: { opacity: 1, transition: { staggerChildren: reduce ? 0 : stagger } },
});

// ponytail: one slide pattern for step flows — `custom` carries +1 forward / -1 back.
// Reduced motion keeps the crossfade and drops only the travel.
export const slide = (reduce: boolean, offset = 24): Variants => ({
  enter: (dir: number) => ({ opacity: 0, x: reduce ? 0 : dir * offset }),
  center: {
    opacity: 1,
    x: 0,
    transition: { duration: reduce ? 0.15 : 0.28, ease: "easeOut" as const },
  },
  exit: (dir: number) => ({
    opacity: 0,
    x: reduce ? 0 : dir * -offset,
    transition: { duration: reduce ? 0.15 : 0.2, ease: "easeIn" as const },
  }),
});

export const item = (reduce: boolean, offset: number, duration: number): Variants => ({
  hidden: { opacity: 0, y: reduce ? 0 : offset },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: reduce ? 0.2 : duration, ease: "easeOut" as const },
  },
});
