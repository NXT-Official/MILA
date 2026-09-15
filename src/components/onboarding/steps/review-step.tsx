import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HUBS } from "@/constants/climate";
import type { DashboardProfile } from "@/lib/queries/profile";
import type { DetailedColorProfile as StudioDossier } from "@/constants/style-profile";
import type { OnboardingStepId } from "@/constants/steps";

function ReviewSection({
  title,
  value,
  onEdit,
}: {
  title: string;
  value: React.ReactNode;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-4 last:border-b-0">
      <div>
        <p className="text-micro uppercase tracking-label text-muted">{title}</p>
        <div className="mt-1 text-sm text-ink">{value}</div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${title}`}
        className="atelier-focus-ring shrink-0 text-xs text-accent hover:underline"
      >
        Edit
      </button>
    </div>
  );
}

export function ReviewStep({
  profile,
  dossier,
  onEdit,
  onComplete,
  completing,
  completionError,
}: {
  profile: DashboardProfile;
  dossier: StudioDossier | null;
  onEdit: (step: OnboardingStepId) => void;
  onComplete: () => void;
  completing: boolean;
  completionError: string | null;
}) {
  const hub = HUBS.find((h) => h.id === profile.default_location);
  const beautyPrefs = Array.isArray(profile.beauty_preferences)
    ? (profile.beauty_preferences as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  const shoppingPrefs = Array.isArray(profile.shopping_preferences)
    ? (profile.shopping_preferences as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  const stylingConstraints = Array.isArray(profile.styling_constraints)
    ? (profile.styling_constraints as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  const makeupEligible = profile.gender !== "Male";

  return (
    <div>
      <div className="flex items-start gap-3 rounded-card border border-line bg-accent-soft/40 p-5">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-ink">Your Mila profile is ready</p>
          <p className="mt-1 text-xs text-muted leading-relaxed">
            Review the details Mila will use to personalize your daily looks. You can update any of
            these later from Style Profile.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <ReviewSection
          title="Color profile"
          value={dossier ? `${dossier.subSeason} · ${dossier.season}` : "Not set"}
          onEdit={() => onEdit("color-result")}
        />
        <ReviewSection
          title="Skin undertone"
          value={profile.skin_undertone ?? "Not set"}
          onEdit={() => onEdit("color-result")}
        />
        <ReviewSection
          title="Gender"
          value={profile.gender ?? "Not set"}
          onEdit={() => onEdit("gender")}
        />
        <ReviewSection
          title="Body silhouette"
          value={profile.body_type ?? "Not set"}
          onEdit={() => onEdit("body-type")}
        />
        <ReviewSection
          title="Face shape"
          value={profile.face_shape ?? "Not set"}
          onEdit={() => onEdit("face-shape")}
        />
        <ReviewSection
          title="Hair type"
          value={profile.hair_type ?? "Not set"}
          onEdit={() => onEdit("hair-type")}
        />
        <ReviewSection
          title="Hair length"
          value={profile.hair_length ?? "Not set"}
          onEdit={() => onEdit("hair-length")}
        />
        {makeupEligible ? (
          <ReviewSection
            title="Makeup preference"
            value={profile.makeup_preference ?? "none"}
            onEdit={() => onEdit("makeup-preference")}
          />
        ) : null}
        <ReviewSection
          title="Beauty preferences"
          value={beautyPrefs.length > 0 ? beautyPrefs.join(", ") : "No preference selected"}
          onEdit={() => onEdit("beauty-preferences")}
        />
        <ReviewSection
          title="Location"
          value={hub ? `${hub.city} — ${hub.tagline}` : "Not set"}
          onEdit={() => onEdit("location")}
        />
        <ReviewSection
          title="Shopping preferences"
          value={shoppingPrefs.length > 0 ? shoppingPrefs.join(", ") : "No preference selected"}
          onEdit={() => onEdit("shopping-preferences")}
        />
        <ReviewSection
          title="Styling constraints"
          value={
            stylingConstraints.length > 0
              ? stylingConstraints.join(", ")
              : "No constraints selected"
          }
          onEdit={() => onEdit("styling-constraints")}
        />
      </div>

      {completionError ? (
        <p role="alert" className="mt-4 text-xs text-destructive">
          {completionError}
        </p>
      ) : null}

      <div className="mt-8 flex justify-end border-t border-line pt-6">
        <Button size="lg" loading={completing} onClick={onComplete}>
          Complete my style profile
        </Button>
      </div>
    </div>
  );
}
