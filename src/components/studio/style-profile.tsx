import React from "react";
import { Sparkles } from "lucide-react";
import { SEASONS_DATA } from "../../lib/color-analysis/seasonsData";
import { migrateLegacySeason } from "../../lib/color-analysis/schemaMigration";

interface StyleProfileProps {
  profile: {
    color_season: string;
    full_name?: string;
  };
}

export const ColorDossierSection: React.FC<StyleProfileProps> = ({ profile }) => {
  const resolvedSeasonId = migrateLegacySeason(profile.color_season);
  const seasonData = SEASONS_DATA[resolvedSeasonId];

  if (!seasonData) {
    return (
      <div className="rounded-card bg-card border border-border shadow-paper p-8 text-center max-w-2xl">
        <div className="mx-auto mb-4 inline-flex size-10 items-center justify-center rounded-full bg-foreground/6">
          <Sparkles className="size-5 text-accent" />
        </div>
        <h3 className="font-serif text-xl text-foreground tracking-tight">
          Your Color Dossier Awaits
        </h3>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Complete your color analysis mapping to unlock your expert color dossier.
        </p>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined") {
              window.scrollTo({ top: 0, behavior: "smooth" });
            }
          }}
          className="mt-5 inline-flex items-center justify-center h-11 px-6 rounded-none bg-foreground text-background text-xs uppercase tracking-widest hover:bg-foreground/90 transition-colors"
        >
          Start Color Analysis
        </button>
      </div>
    );
  }

  const sisterSeason = SEASONS_DATA[seasonData.sisterSeasonId];

  return (
    <div className="space-y-6 bg-card p-6 rounded-card border border-border shadow-paper">
      <div>
        <h2 className="text-xl font-bold">{seasonData.name} Dossier</h2>
        <p className="text-xs">
          Seasonal Family: {seasonData.family} • Primary Tone: {seasonData.dimensions.undertone}
        </p>
      </div>

      <hr className="border-none border-t border-line opacity-60" />

      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider mb-2.5">
          Your Core Profile Matrix
        </h4>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-xl">
            <span className="block">Depth Value</span>
            <strong className="text-sm">{seasonData.dimensions.value}</strong>
          </div>
          <div className="p-3 rounded-xl">
            <span className="block">Contrast Threshold</span>
            <strong className="text-sm">{seasonData.dimensions.contrast}</strong>
          </div>
          <div className="p-3 rounded-xl">
            <span className="block">Skin Undertone</span>
            <strong className="text-sm">{seasonData.dimensions.undertone}</strong>
          </div>
          <div className="p-3 rounded-xl">
            <span className="block">Chroma Saturation</span>
            <strong className="text-sm">{seasonData.dimensions.chroma}</strong>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-600 mb-2">
            Power Colors
          </h4>
          <ul className="space-y-1 text-sm">
            {seasonData.bestColorsDescription.map((color, index) => (
              <li key={index} className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>{color}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-rose-600 mb-2">
            Muted / Avoid
          </h4>
          <ul className="space-y-1 text-sm">
            {seasonData.avoidColorsDescription.map((color, index) => (
              <li key={index} className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-rose-400" />
                <span>{color}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {sisterSeason && (
        <div className="border rounded-xl p-4 text-xs">
          <span className="font-bold block mb-1 uppercase tracking-wider opacity-80">
            Mila's Stylist Secret: Your Sister Season
          </span>
          <p className="leading-relaxed">
            You share your key structural traits with{" "}
            <strong className="font-bold">{sisterSeason.name}</strong>! When shopping, you can
            comfortably borrow pieces from their palette as long as you pull them back into balance
            using your signature {seasonData.dimensions.undertone.toLowerCase()} accents.
          </p>
        </div>
      )}
    </div>
  );
};
