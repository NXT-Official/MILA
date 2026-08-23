import { useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import { Upload } from "lucide-react";
import { CtaButton } from "@/components/landing/cta-button";
import type { HeroContent } from "@/lib/landing-content";

/* ponytail: fixed copy, not a Sanity field. Add one to the landing schema when
   marketing needs to edit it without a deploy. */
const DEMO_PROMPT =
  "It's 14°C and drizzling, and I have dinner in the city tonight. Something warm-toned, nothing that needs ironing....";

export function HeroSection({ content }: { content: HeroContent }) {
  const reduce = useReducedMotion() ?? false;
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * The page's one orchestrated moment: the hero settles on load, in reading
   * order, and nothing else on the page announces itself this way.
   *
   * `y` only — never opacity. If rAF never runs (hidden tab, headless render)
   * the content is simply a few pixels low rather than invisible.
   */
  const rise = (step: number) => ({
    initial: { y: 14 },
    animate: { y: 0 },
    transition: {
      duration: reduce ? 0 : 0.55,
      delay: reduce ? 0 : step * 0.07,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  });

  return (
    // No scrim: the reel reads at full strength behind the copy, and
    // `atelier-on-reel` pins this subtree to the light palette so the type stays
    // dark on it in both themes. Contrast depends on the footage staying light;
    // if a dark cut lands here, drop the class and add a flat `bg-canvas/60`
    // (never a gradient — the copy column outgrows any fixed-height fade).
    <section id="top" className="atelier-on-reel relative flex min-h-svh flex-col justify-center">
      <div className="atelier-container flex flex-col items-center pb-24 pt-32 text-center">
        <motion.h1
          {...rise(0)}
          className="max-w-[46rem] text-[clamp(2.5rem,6vw,4.25rem)] leading-[1.05] tracking-[-0.03em]"
        >
          {content.headlineLine1}
          <br />
          <span className="text-muted-foreground">{content.headlineLine2}</span>
        </motion.h1>

        <motion.p
          {...rise(1)}
          className="mt-6 max-w-[32rem] text-lg leading-relaxed text-pretty text-muted-foreground sm:text-xl"
        >
          {content.subhead}
        </motion.p>

        {/* The product's one input — an occasion, in your words. A plain surface
            panel on the hairline, not a frosted-glass slab: the reel behind it is
            already the depth, and a second blurred layer just muddies the type. */}
        <motion.div
          {...rise(2)}
          className="mt-12 w-full max-w-[44rem] overflow-hidden rounded-overlay border border-line bg-surface text-left shadow-paper"
        >
          <div className="flex min-h-[13rem] flex-col justify-between gap-8 p-6 sm:p-7">
            <p className="text-lg leading-relaxed text-accent-ink sm:text-xl">{DEMO_PROMPT}</p>

            <div className="flex items-center justify-between gap-3">
              {/* ponytail: the picked file is dropped on the floor — capture
                  lives behind auth, so this only opens the funnel. Hand it to
                  /onboarding/capture via router state to skip a step later. */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={() => navigate({ to: "/login" })}
              />
              <button
                type="button"
                aria-label="Upload your portrait"
                onClick={() => fileInputRef.current?.click()}
                className="atelier-focus-ring flex size-11 shrink-0 items-center justify-center rounded-full border border-line text-ink transition-colors duration-200 ease-editorial hover:bg-accent-soft/60"
              >
                <Upload className="size-[1.125rem] shrink-0" aria-hidden="true" />
              </button>

              <CtaButton />
            </div>
          </div>
        </motion.div>

        <motion.p {...rise(3)} className="mt-5 text-xs text-muted-foreground">
          {content.ctaNote}
        </motion.p>
      </div>

      {/* Colour only, over a long 22rem run — no blur and no mask. The mask was
          a second ramp multiplying the first, which pushed most of the change
          into the last few hundred pixels and stacked it into a dark band. */}
      <div
        aria-hidden="true"
        className="atelier-ground-fade pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[22rem]"
      />
    </section>
  );
}
