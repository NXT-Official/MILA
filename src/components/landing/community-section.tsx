import { Section, SectionHeading } from "@/components/landing/section";
import type { CommunityContent } from "@/lib/landing-content";

export function CommunitySection({
  content,
  children,
}: {
  content: CommunityContent;
  children?: React.ReactNode;
}) {
  return (
    <Section id="community" spacing="generous">
      <SectionHeading align="center" heading={content.heading} body={content.body} />

      {/* ponytail: `content.seasonChips` is still fetched but no longer rendered
          — the swatch row above the testimonials was removed. Drop the field
          from the GROQ query and the type if it stays unused. */}
      {children}
    </Section>
  );
}
