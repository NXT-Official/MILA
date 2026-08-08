import { Section, SectionHeading } from "@/components/landing/section";
import { SeasonTag } from "@/components/landing/season-tag";
import type { CommunityContent } from "@/lib/landing-content";

export function CommunitySection({
  content,
  children,
}: {
  content: CommunityContent;
  children?: React.ReactNode;
}) {
  return (
    <Section id="community">
      <SectionHeading
        align="center"
        kicker={content.kicker}
        heading={content.heading}
        body={content.body}
      />

      <ul className="mt-10 flex flex-wrap justify-center gap-2.5">
        {content.seasonChips.map((season) => (
          <li key={season}>
            <SeasonTag season={season} />
          </li>
        ))}
      </ul>

      {children}
    </Section>
  );
}
