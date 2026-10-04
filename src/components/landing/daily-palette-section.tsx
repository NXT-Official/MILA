import { Section, SectionHeading } from "@/components/landing/section";
import type { DailyPaletteContent } from "@/lib/landing-content";

/** Swatch hex values arrive validated as #RRGGBB (landing-content.normalize). */
export function DailyPaletteSection({ content }: { content: DailyPaletteContent }) {
  return (
    <Section id="palette">
      <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <SectionHeading heading={content.heading} body={content.body} />
        <div className="flex flex-col items-center gap-8">
          <img
            src={content.image.src}
            alt={content.image.alt}
            width={640}
            height={480}
            loading="lazy"
            className="w-full max-w-md rounded-card border border-border object-cover shadow-paper transition-shadow duration-200 ease-editorial hover:shadow-raised"
          />
          <div className="flex justify-center gap-4">
            {content.swatches.map((s) => (
              <div key={s._key} className="flex flex-col items-center gap-2">
                <span
                  className="size-16 rounded-full border-2 border-card shadow-sm sm:size-20"
                  style={{ backgroundColor: s.hex }}
                  aria-hidden="true"
                />
                <span className="text-micro uppercase tracking-label text-muted-foreground">
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}
