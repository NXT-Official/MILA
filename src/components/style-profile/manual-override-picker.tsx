import { ProfileSectionCard } from "@/components/style-profile/profile-section-card";
import { CardMatrix } from "@/components/style-profile/shared";
import { BODY_OPTIONS } from "@/constants/style-profile";

const SEASON_OPTIONS = [
  {
    id: "Spring",
    title: "The Spring Awakening",
    desc: "Warm, luminous, clear, vivid gold undertones",
  },
  {
    id: "Summer",
    title: "The Muted Summer",
    desc: "Cool, soft, ethereal, delicate slate and rose hues",
  },
  { id: "Autumn", title: "The Rich Autumn", desc: "Deep, warm, earthy, sun-drenched ochre tones" },
  {
    id: "Winter",
    title: "The Vivid Winter",
    desc: "Sharp, cool, striking contrast, clear jewel profiles",
  },
] as const;

const CONTRAST_OPTIONS = [
  { id: "Low Contrast", name: "Soft & Blended", sub: "Subtle transitions" },
  { id: "Medium Contrast", name: "Balanced Depth", sub: "Classic equilibrium" },
  { id: "High Contrast", name: "Striking Contrast", sub: "High-drama definition" },
] as const;

export function ManualOverridePicker({
  manualSeason,
  manualContrast,
  bodyType,
  onPickSeason,
  onPickContrast,
  onPickBody,
}: {
  manualSeason: string;
  manualContrast: string;
  bodyType: string;
  onPickSeason: (v: string) => void;
  onPickContrast: (v: string) => void;
  onPickBody: (v: string) => void;
}) {
  return (
    <div className="mt-6 space-y-8 px-1 sm:px-2">
      <ProfileSectionCard className="p-8 max-w-2xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <span className="text-[0.18em] uppercase tracking-label-xwide text-stone text-xs block">
            Private Consultation
          </span>
          <h3 className="font-serif text-2xl text-ink tracking-wide">
            Determine Your Seasonal Palette
          </h3>
          <p className="text-sm text-stone max-w-md mx-auto">
            Aligning the natural undertones of your skin, hair, and eyes with curated textile
            seasons.
          </p>
        </div>
        <div className="space-y-6">
          <div className="space-y-3" role="group" aria-labelledby="season-group-label">
            <span
              id="season-group-label"
              className="text-xs uppercase tracking-label text-ink font-medium block"
            >
              Your Prevailing Season
            </span>
            <div className="grid grid-cols-2 gap-3">
              {SEASON_OPTIONS.map((season) => {
                const active = manualSeason === season.id;
                return (
                  <button
                    key={season.id}
                    type="button"
                    onClick={() => onPickSeason(season.id)}
                    className={`p-4 text-left rounded-xl border transition-all duration-300 group ${active ? "bg-surface dark:bg-secondary border-stone/40 shadow-atelier-soft" : "border-stone/10 bg-porcelain/30 hover:bg-surface dark:hover:bg-secondary hover:border-stone/30 hover:shadow-atelier-soft"}`}
                  >
                    <span className="font-serif text-base text-ink block group-hover:text-rose transition-colors">
                      {season.title}
                    </span>
                    <span className="text-xs text-stone mt-1 block leading-relaxed">
                      {season.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div
            className="space-y-3 pt-4 border-t border-porcelain/30"
            role="group"
            aria-labelledby="contrast-group-label"
          >
            <span
              id="contrast-group-label"
              className="text-xs uppercase tracking-label text-ink font-medium block"
            >
              The Depth of Contrast
            </span>
            <p className="text-xs text-stone mb-2">
              The relationship between the intensity of your features and textiles.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {CONTRAST_OPTIONS.map((contrast) => {
                const active = manualContrast === contrast.id;
                return (
                  <button
                    key={contrast.id}
                    type="button"
                    onClick={() => onPickContrast(contrast.id)}
                    className={`p-3 text-center rounded-lg border transition-all duration-300 ${active ? "bg-surface dark:bg-secondary border-stone/40 shadow-atelier-soft" : "border-stone/10 bg-porcelain/20 hover:bg-surface dark:hover:bg-secondary"}`}
                  >
                    <span className="text-xs uppercase tracking-wider font-semibold text-ink block">
                      {contrast.name}
                    </span>
                    <span className="text-micro text-stone mt-0.5 block">{contrast.sub}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </ProfileSectionCard>
      <CardMatrix
        label="Your silhouette"
        value={bodyType}
        onPick={onPickBody}
        options={BODY_OPTIONS}
      />
    </div>
  );
}
