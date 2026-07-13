import { Reveal } from "@/components/landing/reveal";
import { SeasonTag } from "@/components/landing/season-tag";

const SEASONS = ["True Summer", "Soft Autumn", "Deep Winter", "Light Spring"];

export function CommunitySection() {
  return (
    <Reveal className="mx-auto w-full max-w-6xl px-6 pb-24">
      <p className="atelier-kicker">The feed</p>
      <h2 className="mt-2 max-w-xl font-serif">A feed that actually makes sense for you.</h2>
      <p className="mt-4 max-w-lg text-sm leading-relaxed">
        Only the looks that could work for your season — real outfits from women who share your
        palette, not whatever's trending. Share your look, unlock the feed. Everyone here actually
        dresses with intention.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        {SEASONS.map((s) => (
          <SeasonTag key={s} season={s} />
        ))}
      </div>
    </Reveal>
  );
}
