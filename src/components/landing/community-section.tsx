import { Reveal } from "@/components/landing/reveal";
import { SeasonTag } from "@/components/landing/season-tag";
import type { CommunityContent } from "@/lib/landing-content";

export function CommunitySection({ content }: { content: CommunityContent }) {
  return (
    <Reveal className="mx-auto w-full max-w-6xl px-6 pb-24">
      <p className="atelier-kicker">{content.kicker}</p>
      <h2 className="mt-2 max-w-xl font-serif">{content.heading}</h2>
      <p className="mt-4 max-w-lg text-base leading-relaxed text-pretty">{content.body}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        {content.seasonChips.map((s) => (
          <SeasonTag key={s} season={s} />
        ))}
      </div>
    </Reveal>
  );
}
