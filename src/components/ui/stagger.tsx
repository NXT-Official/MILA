import { motion, useReducedMotion } from "framer-motion";
import { container, item } from "@/lib/motion";

export function Stagger({
  children,
  className,
  stagger = 0.09,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  stagger?: number;
  as?: "div" | "section" | "ul";
}) {
  const reduce = useReducedMotion() ?? false;
  const Comp = motion[as];

  return (
    <Comp
      className={className}
      variants={container(reduce, stagger)}
      initial="hidden"
      animate="visible"
    >
      {children}
    </Comp>
  );
}

export function StaggerItem({
  children,
  className,
  offset = 18,
  duration = 0.5,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  offset?: number;
  duration?: number;
  as?: "div" | "section" | "li" | "article";
}) {
  const reduce = useReducedMotion() ?? false;
  const Comp = motion[as];

  return (
    <Comp className={className} variants={item(reduce, offset, duration)}>
      {children}
    </Comp>
  );
}
