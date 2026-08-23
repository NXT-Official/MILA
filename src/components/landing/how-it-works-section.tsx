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
          Rules between the steps and nothing around them: an outer box would
          make three peers look like one object. */}
      <motion.ol
        className="mt-16 divide-y divide-line sm:mt-20 lg:grid lg:grid-cols-3 lg:divide-x lg:divide-y-0"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-80px" }}
        variants={{ visible: { transition: { staggerChildren: reduce ? 0 : 0.08 } } }}
      >
        {content.steps.map((step) => (
          <motion.li
            key={step._key}
            variants={stepVariants}
            className="py-10 lg:px-10 lg:py-2 lg:first:pl-0 lg:last:pr-0"
          >
            {/* The <ol> already conveys order to assistive tech. Small and set
                in the label style rather than a display numeral: the step's
                title is the thing to read, the index only places it. */}
            <span
              aria-hidden="true"
              className="block text-label font-semibold uppercase tracking-label text-accent-ink"
            >
              {step.number}
            </span>
            <h3 className="mt-5 text-xl leading-snug tracking-[-0.01em] text-balance text-foreground">
              {step.title}
            </h3>
            <p className="mt-3 max-w-[38ch] text-base leading-[1.7] text-pretty text-muted-foreground">
              {step.body}
            </p>
          </motion.li>
        ))}
      </motion.ol>
    </Section>
  );
}
