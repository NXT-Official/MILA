import { Section, SectionHeading } from "@/components/landing/section";

const SWATCHES = [
  { label: "Base Layer", hex: "#D8C4A0" },
  { label: "Statement", hex: "#8B4A62" },
  { label: "Accent Pop", hex: "#C9A227" },
];

export function DailyPaletteSection() {
  return (
    <Section id="palette">
      <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <SectionHeading
          heading="A new color mix, every morning."
          body="Three colors pulled fresh from your season each day — base, statement, and accent — so you never second-guess what goes together."
        />
        <div className="flex flex-col items-center gap-8">
          <img
            src="/landing/palette-flatlay.jpg"
            alt="Flat-lay of camel, deep berry, and gold garments — one day's color palette"
            width={640}
            height={480}
            loading="lazy"
            className="w-full max-w-md rounded-card border border-border object-cover shadow-paper transition-shadow duration-200 ease-editorial hover:shadow-raised"
          />
          <div className="flex justify-center gap-4">
            {SWATCHES.map((s) => (
              <div key={s.label} className="flex flex-col items-center gap-2">
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
