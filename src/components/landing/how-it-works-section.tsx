import { useRef } from "react";
import {
  motion,
  useInView,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
  type Variants,
} from "framer-motion";
import { ScanFace, Sparkles, Users, type LucideIcon } from "lucide-react";
import { Section, SectionHeading } from "@/components/landing/section";
import type { HowItWorksContent, Step } from "@/lib/landing-content";
import { cn } from "@/lib/utils";

/* ponytail: icons by position, not by content. `Step` has no icon field, and a
   three-step sequence that changes order is a rewrite of the section anyway.
   Add an `icon` name to the Sanity schema when marketing needs a fourth step. */
const STEP_ICONS: LucideIcon[] = [ScanFace, Sparkles, Users];

export function HowItWorksSection({ content }: { content: HowItWorksContent }) {
  const reduce = useReducedMotion() ?? false;
  const listRef = useRef<HTMLOListElement>(null);

  // The rail fills as the list crosses the middle of the viewport — the same
  // line the active-step test uses below, so the gold always reaches a step at
  // the moment that step lights up.
  const { scrollYProgress } = useScroll({
    target: listRef,
    offset: ["start center", "end center"],
  });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 26, mass: 0.4 });

  // Only `y` moves — the steps are legible before the reveal ever fires.
  // `hidden` never branches on `reduce`: SSR has no matchMedia, so a branched
  // initial state desyncs hydration and can strand the element mid-transform.
  const stepVariants: Variants = {
    hidden: { y: 12 },
    visible: { y: 0, transition: { duration: reduce ? 0 : 0.4, ease: [0.22, 1, 0.36, 1] } },
  };

  return (
    <Section id="how-it-works">
      <SectionHeading align="center" heading={content.heading} />

      {/* One thread, walked top to bottom: the rail is what makes the steps read
          as a single sequence instead of three peers. It's drawn per row rather
          than as one absolute line over the list, so it starts exactly at the
          first marker and stops exactly at the last however tall the rows
          resolve — and each row owns the slice of gold it fills in. */}
      <motion.ol
        ref={listRef}
        className="mx-auto mt-20 max-w-4xl sm:mt-24"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-80px" }}
        variants={{ visible: { transition: { staggerChildren: reduce ? 0 : 0.08 } } }}
      >
        {content.steps.map((step, i) => (
          <StepRow
            key={step._key}
            step={step}
            index={i}
            count={content.steps.length}
            progress={progress}
            reduce={reduce}
            variants={stepVariants}
          />
        ))}
      </motion.ol>
    </Section>
  );
}

function StepRow({
  step,
  index,
  count,
  progress,
  reduce,
  variants,
}: {
  step: Step;
  index: number;
  count: number;
  progress: MotionValue<number>;
  reduce: boolean;
  variants: Variants;
}) {
  const ref = useRef<HTMLLIElement>(null);
  // A band across the middle of the viewport, not the whole of it: with the
  // rows this tall, "in view" would otherwise mean two steps at once.
  const active = useInView(ref, { margin: "-45% 0px -45% 0px" });

  const Icon = STEP_ICONS[index] ?? Sparkles;
  const isFirst = index === 0;
  const isLast = index === count - 1;
  // Alternation is composition on a wide screen and nonsense on a narrow one,
  // so it only exists at `lg`: below that the rail sits left and every row reads
  // the same way.
  const railSide = index % 2 === 0;

  // This row's slice of the list's scroll: 0 until the rail reaches it, 1 once
  // the rail has passed it.
  const fill = useTransform(progress, [index / count, (index + 1) / count], [0, 1], {
    clamp: true,
  });

  const railPosition = cn(
    "absolute left-6 w-px -translate-x-1/2 lg:left-1/2",
    isFirst ? "top-1/2" : "top-0",
    isLast ? "bottom-1/2" : "bottom-0",
  );

  return (
    <motion.li
      ref={ref}
      variants={variants}
      // Height in `vh`, not padding: each step gets close to a screen of its
      // own, so the rail has room to travel between markers and the active band
      // only ever holds one of them. Padding is the floor for long copy.
      className="relative grid min-h-[36vh] grid-cols-[auto_1fr] items-center gap-x-4 py-12 sm:gap-x-6 sm:py-16 lg:min-h-[58vh] lg:grid-cols-[1fr_3rem_1fr] lg:gap-x-8 lg:py-20"
    >
      {/* Narrow, the rail runs behind the markers — a dot column would cost 24px
          of measure on a 390px screen to say what the tile already sits on. It
          only becomes its own column at `lg`. */}
      <span aria-hidden="true" className={cn(railPosition, "bg-line")} />
      {reduce ? null : (
        <motion.span
          aria-hidden="true"
          className={cn(railPosition, "origin-top bg-accent")}
          style={{ scaleY: fill }}
        />
      )}

      {/* The one gold mark in the section, spent on where the reader is. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-1/2 top-1/2 hidden size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-canvas transition-colors duration-500 ease-editorial lg:block",
          active ? "border-accent bg-accent" : "border-line",
        )}
      />

      {/* Marker: the icon carries the step, the numeral places it. Stacked on
          the rail below `lg`, and on the far side of the rail above it — the
          numeral always the half nearer the line. */}
      <div
        className={cn(
          "relative row-start-1 col-start-1 flex flex-col items-center gap-2 lg:flex-row lg:gap-4 lg:justify-self-center",
          railSide ? "lg:col-start-1" : "lg:col-start-3 lg:flex-row-reverse",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex size-12 items-center justify-center rounded-panel border bg-surface transition-colors duration-500 ease-editorial lg:size-14",
            active ? "border-accent text-accent-ink" : "border-line text-muted-foreground",
          )}
        >
          <Icon className="size-5 lg:size-6" strokeWidth={1.75} />
        </span>
        <span
          aria-hidden="true"
          className={cn(
            // Not `tracking-label`: 0.2em on a two-digit numeral reads as two
            // numbers with a gap, and the trailing space breaks the pill.
            "rounded-pill border bg-surface px-2 py-0.5 text-micro font-semibold tabular-nums tracking-[0.06em] transition-colors duration-500 ease-editorial",
            active ? "border-accent text-accent-ink" : "border-line text-muted-foreground",
          )}
        >
          {step.number}
        </span>
      </div>

      {/* The <ol> already conveys order to assistive tech; the marker above is
          decoration on top of it, which is why all of it is aria-hidden. */}
      <div
        className={cn(
          "row-start-1 col-start-2 max-w-[36ch] lg:max-w-[34ch]",
          railSide
            ? "lg:col-start-3 lg:justify-self-start"
            : "lg:col-start-1 lg:justify-self-end lg:text-right",
        )}
      >
        <h3 className="text-lg leading-snug tracking-[-0.01em] text-balance text-foreground lg:text-xl">
          {step.title}
        </h3>
        <p className="mt-2 text-base leading-[1.7] text-pretty text-muted-foreground">
          {step.body}
        </p>
      </div>
    </motion.li>
  );
}
