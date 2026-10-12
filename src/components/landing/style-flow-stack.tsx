import { useEffect, useRef, type ReactNode } from "react";
import type { ConciergeContent, DailyPaletteContent } from "@/lib/landing-content";
import { mountStackMotion } from "@/components/landing/sticky-stack-motion";
import {
  STYLE_FLOW_SHOP,
  STYLE_FLOW_STEPS,
  styleFlowHeading,
  type StyleFlowStep,
} from "@/components/landing/style-flow-copy";

/**
 * One section for the three things Mila does every morning: read her colors
 * (the Studio's daily palette copy), compose the look (the Studio's concierge
 * copy) and shop it (the concierge image, code-owned copy). It replaces the
 * two text and image splits that sat back to back.
 *
 * The markup is the static page: three stacked panels, which is what the
 * server sends, what a narrow screen keeps and what reduced motion keeps. On a
 * wide screen with motion allowed, an effect loads GSAP and pins the panels
 * (sticky-stack-motion.ts). No Motion components live in this tree, so GSAP
 * and Motion never drive the same elements.
 *
 * Visibility follows the Studio: a hidden palette drops its panel, a hidden
 * concierge drops the two panels built from it, and with both hidden the
 * section is gone.
 */
export function StyleFlowStack({
  palette,
  concierge,
}: {
  palette: DailyPaletteContent;
  concierge: ConciergeContent;
}) {
  const stackRef = useRef<HTMLDivElement>(null);
  const steps: StyleFlowStep[] = [
    ...(palette.hidden ? [] : (["palette"] as const)),
    ...(concierge.hidden ? [] : (["compose", "shop"] as const)),
  ];
  const stepKey = steps.join(" ");

  useEffect(() => {
    const root = stackRef.current;
    if (!root) return;
    return mountStackMotion(root, { matchMedia: (query) => window.matchMedia(query) });
  }, [stepKey]);

  if (!steps.length) return null;

  return (
    <section
      id="style-flow"
      aria-labelledby="style-flow-heading"
      className="relative isolate scroll-mt-16 border-t border-border"
    >
      <div className="atelier-container pt-20 sm:pt-24">
        <h2 id="style-flow-heading" className="max-w-2xl text-[clamp(2rem,4vw,3rem)] leading-[1.1]">
          {styleFlowHeading(steps)}
        </h2>
      </div>

      <div
        ref={stackRef}
        className="flex flex-col gap-6 pb-20 pt-10 sm:pb-24 sm:pt-12 lg:gap-10 data-[stack-motion=on]:gap-0"
      >
        {steps.includes("palette") && (
          <StackPanel id="palette" step="palette" heading={palette.heading} body={palette.body}>
            {{
              extra: (
                <ul className="mt-8 flex flex-wrap gap-5" aria-label="Today's colors">
                  {palette.swatches.map((s) => (
                    <li key={s._key} className="flex flex-col items-center gap-2">
                      <span
                        className="size-14 rounded-full border-2 border-card shadow-paper sm:size-16"
                        style={{ backgroundColor: s.hex }}
                        aria-hidden="true"
                      />
                      <span className="text-label font-semibold text-ink">{s.label}</span>
                    </li>
                  ))}
                </ul>
              ),
              visual: <PanelImage src={palette.image.src} alt={palette.image.alt} />,
            }}
          </StackPanel>
        )}

        {steps.includes("compose") && (
          <StackPanel
            id="concierge"
            step="compose"
            heading={concierge.heading}
            body={concierge.body}
          >
            {{
              visual: (
                <ol
                  aria-label="A sample conversation with Mila"
                  className="flex flex-col justify-center gap-4 rounded-panel bg-canvas p-6 sm:p-8"
                >
                  {concierge.exchange.map((m) => {
                    const fromMember = m.role === "user";
                    return (
                      <li
                        key={m._key}
                        className={
                          fromMember
                            ? "ml-auto flex max-w-[85%] flex-col items-end gap-1.5"
                            : "mr-auto flex max-w-[85%] flex-col items-start gap-1.5"
                        }
                      >
                        <span className="text-label font-semibold text-muted-foreground">
                          {fromMember ? "You" : "Mila"}
                        </span>
                        <p
                          className={
                            fromMember
                              ? "rounded-2xl rounded-br-sm bg-ink px-4 py-3 text-sm leading-relaxed text-surface"
                              : "rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3 text-sm leading-relaxed text-foreground"
                          }
                        >
                          {m.text}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              ),
            }}
          </StackPanel>
        )}

        {steps.includes("shop") && (
          <StackPanel step="shop" heading={STYLE_FLOW_SHOP.heading} body={STYLE_FLOW_SHOP.body}>
            {{ visual: <PanelImage src={concierge.image.src} alt={concierge.image.alt} /> }}
          </StackPanel>
        )}
      </div>
    </section>
  );
}

/**
 * One panel. The outer block is what GSAP pins. It has no background, so only
 * the opaque card covers what it scrolls over: an opaque panel wiped the
 * pinned card with blank canvas before the next card arrived (LANDING review
 * C1). The inner card is what recedes. Below `lg` it is one column.
 */
function StackPanel({
  id,
  step,
  heading,
  body,
  children,
}: {
  id?: string;
  step: StyleFlowStep;
  heading: string;
  body: string;
  children: { extra?: ReactNode; visual: ReactNode };
}) {
  const headingId = `style-flow-${step}-heading`;
  return (
    <article
      id={id}
      aria-labelledby={headingId}
      data-stack-panel=""
      className="relative scroll-mt-16"
    >
      <div className="atelier-container w-full">
        <div
          data-stack-card=""
          className="grid items-center gap-10 rounded-card border border-border bg-card p-6 shadow-paper sm:p-10 lg:grid-cols-2 lg:gap-16 lg:p-14"
        >
          <div>
            <p className="text-label font-semibold text-ink">{STYLE_FLOW_STEPS[step].title}</p>
            <h3
              id={headingId}
              className="mt-4 font-serif text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.1] text-foreground"
            >
              {heading}
            </h3>
            <p className="mt-5 max-w-[52ch] text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
              {body}
            </p>
            {children.extra}
          </div>
          {children.visual}
        </div>
      </div>
    </article>
  );
}

function PanelImage({ src, alt }: { src: string; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      width={960}
      height={640}
      loading="lazy"
      className="aspect-3/2 w-full rounded-panel border border-border object-cover lg:max-h-[56dvh]"
    />
  );
}
