import { motion, useReducedMotion, type Variants } from "framer-motion";
import { Section, SectionHeading } from "@/components/landing/section";
import type { HowItWorksContent } from "@/lib/landing-content";

export function HowItWorksSection({ content }: { content: HowItWorksContent }) {
  const reduce = useReducedMotion() ?? false;

  // Only `y` moves — the steps are legible before the reveal ever fires.
  // `hidden` never branches on `reduce`: SSR has no matchMedia, so a branched
  // initial state desyncs hydration and can strand the element mid-transform.
  const stepVariants: Variants = {
    hidden: { y: 12 },
    visible: { y: 0, transition: { duration: reduce ? 0 : 0.4, ease: [0.22, 1, 0.36, 1] } },
  };

  return (
    <Section id="how-it-works" spacing="tight">
      <SectionHeading align="center" heading={content.heading} />

      {/* A real ordered sequence, so it reads as one — not three identical cards.
          The 1px Rule divides the steps; no box, no icon tile. */}
      <motion.ol
        className="mt-12 divide-y divide-border border-y border-border sm:mt-14 lg:grid lg:grid-cols-3 lg:divide-x lg:divide-y-0"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-80px" }}
        variants={{ visible: { transition: { staggerChildren: reduce ? 0 : 0.08 } } }}
      >
        {content.steps.map((step) => (
          <motion.li
            key={step._key}
            variants={stepVariants}
            className="py-9 lg:px-8 lg:py-10 lg:first:pl-0 lg:last:pr-0"
          >
            {/* The <ol> already conveys order to assistive tech. */}
            <span
              aria-hidden="true"
              className="block font-serif text-4xl leading-none text-muted-foreground"
            >
              {step.number}
            </span>
            <h3 className="mt-6 font-serif text-2xl leading-snug text-balance text-foreground">
              {step.title}
            </h3>
            <p className="mt-3 max-w-sm text-base leading-relaxed text-pretty text-muted-foreground">
              {step.body}
            </p>
          </motion.li>
        ))}
      </motion.ol>
    </Section>
  );
}
