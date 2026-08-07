import { motion, useReducedMotion, type Variants } from "framer-motion";

export function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion() ?? false;
  const sectionVariants: Variants = {
    hidden: { y: reduce ? 0 : 16 },
    visible: { y: 0, transition: { duration: reduce ? 0 : 0.4, ease: [0.22, 1, 0.36, 1] } },
  };

  return (
    <motion.section
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
