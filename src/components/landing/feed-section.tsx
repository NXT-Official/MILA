import { Camera } from "lucide-react";
import { Section, SectionHeading } from "@/components/landing/section";

export function FeedSection() {
  return (
    <Section id="feed">
      <SectionHeading
        align="center"
        kicker="The Atelier Feed"
        heading="Post today's fit. See everyone else's."
        body="One photo, tagged automatically — every piece becomes shoppable for the whole community."
      />
      <div className="mt-10 flex justify-center">
        <span className="inline-flex items-center gap-2 rounded-pill border border-border bg-card px-4 py-2 text-label uppercase tracking-label text-muted-foreground">
          <Camera className="size-3.5 text-accent" aria-hidden="true" />
          Daily Drop — live now
        </span>
      </div>
    </Section>
  );
}
