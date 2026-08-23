import { useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import { Upload } from "lucide-react";
import { CtaButton } from "@/components/landing/cta-button";
import type { HeroContent } from "@/lib/landing-content";

/* ponytail: placeholder reel hotlinked from the design comp — wrong footage, and
   a third-party host that can vanish. Drop a MILA cut at /public/hero.mp4 and
   point here; the dev-only CSP hole in vite.config.ts goes away with it. */
const HERO_VIDEO =
  "https://pollen-batch-41236914.figma.site/_components/v2/f0ee2dae7671c170c34f12e31c4cb41418976c98/769c564298c132f7919405cd9f17c1b1231f341d.769c5642.mp4";

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
    <section id="top" className="relative min-h-svh w-full overflow-hidden">
      {/* A looping reel is unrequested motion — under reduced-motion the canvas
          alone is the ground. */}
      {!reduce && (
        <video
          className="absolute inset-0 z-0 size-full object-cover"
          src={HERO_VIDEO}
          autoPlay
          muted
          loop
          playsInline
          aria-hidden="true"
        />
      )}

      {/* Canvas-to-transparent fade so the nav and copy read as ink on paper over
          whatever frame is playing. Two things it must not be: a hardcoded white
          (strands dark mode) or a fixed pixel height (the copy column is taller on
          a phone than the fade is, and the last line lands on raw video). It rides
          the content box instead, and the fade sits entirely in the trailing
          padding — every line of type is on solid canvas at every width. */}
      <div className="relative z-[1] bg-gradient-to-b from-canvas from-[82%] to-transparent">
        <div className="atelier-container flex flex-col items-center pb-40 pt-28 text-center sm:pt-32">
          <motion.h1
            {...rise(0)}
            className="max-w-[820px] text-[clamp(2.5rem,6vw,4.25rem)] leading-[1.05] tracking-[-0.04em]"
          >
            {content.headlineLine1}
            <br />
            <span className="text-muted-foreground">{content.headlineLine2}</span>
          </motion.h1>

          <motion.p
            {...rise(1)}
            className="mt-5 max-w-[500px] text-xl font-medium leading-relaxed text-pretty text-muted-foreground"
          >
            {content.subhead}
          </motion.p>

          {/* Liquid glass: near-transparent fill, thick white border, heavy blur.
              The card is the product's one input — an occasion, in your words. */}
          <motion.div
            {...rise(2)}
            className="mt-10 w-[701px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-[44px] border-[3px] border-white bg-white/[0.06] shadow-[0_0_4px_0_rgba(0,0,0,0.15)] backdrop-blur-[20px]"
          >
            <div className="flex min-h-[202px] flex-col justify-between p-[18px]">
              <p className="px-2 pt-1.5 text-left text-xl font-medium leading-relaxed text-accent-ink max-md:text-[17px]">
                {DEMO_PROMPT}
              </p>

              <div className="mt-8 flex items-center justify-between gap-3">
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
                  className="atelier-focus-ring flex size-11 shrink-0 items-center justify-center rounded-full border border-white/70 backdrop-blur-[14px] transition-transform duration-200 ease-editorial hover:scale-105 motion-reduce:hover:scale-100"
                >
                  <Upload className="size-[18px] shrink-0 text-ink" aria-hidden="true" />
                </button>

                <CtaButton className="h-14 rounded-[44px]" />
              </div>
            </div>
          </motion.div>

          <motion.span {...rise(3)} className="mt-4 text-xs text-muted-foreground">
            {content.ctaNote}
          </motion.span>
        </div>
      </div>
    </section>
  );
}
