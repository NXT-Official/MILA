import type { Variants } from "framer-motion";

// ponytail: one entrance pattern for every page — container fades its children in sequence.
// Reduced motion collapses the stagger and the offset instead of dropping the mount animation.
export const container = (reduce: boolean, stagger: number): Variants => ({
  hidden: { opacity: 1 },
  visible: { opacity: 1, transition: { staggerChildren: reduce ? 0 : stagger } },
});

export const item = (reduce: boolean, offset: number, duration: number): Variants => ({
  hidden: { opacity: 0, y: reduce ? 0 : offset },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: reduce ? 0.2 : duration, ease: "easeOut" as const },
  },
});
