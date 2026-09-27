import { motion, useReducedMotion, type Variants } from "framer-motion";

export function Reveal({
  children,
  className,
  id,
  "aria-label": ariaLabel,
  stagger = false,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
  "aria-label"?: string;
  stagger?: boolean;
}) {
  const reduce = useReducedMotion() ?? false;
  const sectionVariants: Variants = stagger
    ? { hidden: {}, visible: { transition: { staggerChildren: reduce ? 0 : 0.1 } } }
    : {
        hidden: { y: reduce ? 0 : 16 },
        visible: { y: 0, transition: { duration: reduce ? 0 : 0.4, ease: [0.22, 1, 0.36, 1] } },
      };

  return (
    <motion.section
      id={id}
      aria-label={ariaLabel}
      className={className}
      variants={sectionVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
    >
      {children}
    </motion.section>
  );
}

export function RevealItem({
  children,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "li";
}) {
  const reduce = useReducedMotion() ?? false;
  const itemVariants: Variants = {
    hidden: { y: reduce ? 0 : 12, opacity: reduce ? 1 : 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: { duration: reduce ? 0 : 0.35, ease: [0.22, 1, 0.36, 1] },
    },
  };
  const MotionTag = as === "li" ? motion.li : motion.div;
  return (
    <MotionTag className={className} variants={itemVariants}>
      {children}
    </MotionTag>
  );
}
