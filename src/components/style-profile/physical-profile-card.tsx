import { ProfileSectionCard } from "@/components/style-profile/profile-section-card";
import { PillRow, BeautyPillTray, CardMatrix } from "@/components/style-profile/shared";
import {
  BODY_OPTIONS,
  FACE_SHAPES as HOLISTIC_FACE_SHAPES,
  HAIR_TYPES as HOLISTIC_HAIR_TYPES,
  UNDERTONES,
} from "@/constants/style-profile";

const CONTRAST_OPTIONS = [
  { id: "Low Contrast", name: "Soft & Blended", sub: "Subtle transitions" },
  { id: "Medium Contrast", name: "Balanced Depth", sub: "Classic equilibrium" },
  { id: "High Contrast", name: "Striking Contrast", sub: "High-drama definition" },
] as const;

function Field({
  eyebrow,
  title,
  caption,
  children,
}: {
  eyebrow: string;
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-nano uppercase tracking-label-max text-accent">{eyebrow}</p>
        <h3 className="font-serif text-xl tracking-tight text-foreground">{title}</h3>
        {caption && (
          <p className="text-xs text-muted-foreground leading-relaxed max-w-xl">{caption}</p>
        )}
      </div>
      {children}
    </section>
  );
}

export function PhysicalProfileCard({
  bodyType,
  onPickBody,
  contrast,
  onPickContrast,
  faceShape,
  onPickFace,
  hairType,
  onPickHair,
  undertone,
  onPickUndertone,
  beautyPrefs,
  onToggleBeauty,
}: {
  bodyType: string;
  onPickBody: (v: string) => void;
  contrast: string;
  onPickContrast: (v: string) => void;
  faceShape: string | null;
  onPickFace: (v: string) => void;
  hairType: string | null;
  onPickHair: (v: string) => void;
  undertone: string;
  onPickUndertone: (v: string) => void;
  beautyPrefs: string[];
  onToggleBeauty: (tag: string) => void;
}) {
  return (
    <ProfileSectionCard className="space-y-10">
      <div className="text-center">
        <p className="atelier-kicker">Physical Profile</p>
        <h2 className="font-serif text-2xl sm:text-3xl tracking-tight mt-2">
          The vectors behind every recommendation
        </h2>
      </div>

      <CardMatrix
        label="Body Silhouette"
        value={bodyType}
        onPick={onPickBody}
        options={BODY_OPTIONS}
      />

      <Field
        eyebrow="Feature Contrast"
        title="Contrast Level"
        caption="The difference in lightness between your skin, eyes, and hair — drives how bold or tonal your palette reads."
      >
        <div className="grid grid-cols-3 gap-2">
          {CONTRAST_OPTIONS.map((c) => {
            const active = contrast === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onPickContrast(c.id)}
                className={`p-3 text-center rounded-lg border transition-all duration-300 ${
                  active
                    ? "bg-accent-soft border-accent text-ink"
                    : "border-border bg-card hover:border-accent/40"
                }`}
              >
                <span className="text-xs uppercase tracking-wider font-semibold block">
                  {c.name}
                </span>
                <span className="text-micro text-muted-foreground mt-0.5 block">{c.sub}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <Field eyebrow="Face Geometry" title="Face Shape">
        <PillRow
          value={faceShape}
          options={HOLISTIC_FACE_SHAPES as unknown as string[]}
          onSelect={onPickFace}
        />
      </Field>

      <Field eyebrow="Texture" title="Hair Texture">
        <PillRow
          value={hairType}
          options={HOLISTIC_HAIR_TYPES as unknown as string[]}
          onSelect={onPickHair}
        />
      </Field>

      <Field eyebrow="Palette Baseline" title="Skin Undertone">
        <PillRow
          value={undertone}
          options={UNDERTONES as unknown as string[]}
          onSelect={onPickUndertone}
        />
      </Field>

      <Field
        eyebrow="Beauty & Finish"
        title="Beauty Preferences"
        caption="Tap to toggle the finishes you gravitate toward."
      >
        <BeautyPillTray active={beautyPrefs} onToggle={onToggleBeauty} />
      </Field>
    </ProfileSectionCard>
  );
}
