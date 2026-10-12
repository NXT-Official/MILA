import { Section, SectionHeading } from "@/components/landing/section";
import type { ConciergeContent } from "@/lib/landing-content";

/**
 * Not on the home page since 2026-10-07: the palette and concierge copy now
 * renders in `StyleFlowStack`, one sticky stack instead of two back-to-back
 * text and image splits. Kept as a standalone section (the owner rule is to
 * delete nothing), ready for a page of its own.
 */
export function ConciergeSection({ content }: { content: ConciergeContent }) {
  return (
    <Section id="concierge">
      <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <SectionHeading heading={content.heading} body={content.body} />
        <div className="space-y-6">
          <img
            src={content.image.src}
            alt={content.image.alt}
            width={640}
            height={480}
            loading="lazy"
            className="w-full rounded-card border border-border object-cover shadow-paper transition-shadow duration-200 ease-editorial hover:shadow-raised"
          />
          <div className="space-y-3">
            {content.exchange.map((m) => (
              <div
                key={m._key}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-ink px-4 py-3 text-sm text-surface"
                    : "mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3 text-sm text-foreground"
                }
              >
                {m.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}
