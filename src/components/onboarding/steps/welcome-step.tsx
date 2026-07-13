import { ArrowRight, Palette, Ruler, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

const REASONS = [
  {
    icon: Palette,
    title: "Your coloring",
    body: "Undertone and seasonal palette shape every color recommendation Mila makes.",
  },
  {
    icon: Ruler,
    title: "Your silhouette & features",
    body: "Body shape, face shape, and hair type guide fit, cut, and styling choices.",
  },
  {
    icon: Sparkles,
    title: "Your preferences",
    body: "Beauty preferences and location fine-tune looks to how — and where — you actually live.",
  },
];

export function WelcomeStep({ onBegin }: { onBegin: () => void }) {
  return (
    <div className="py-6 sm:py-10">
      <p className="text-xs uppercase tracking-[0.16em] text-accent font-semibold">
        Digital Style Dossier
      </p>
      <h1
        id="onboarding-step-heading"
        tabIndex={-1}
        className="mt-2 font-display text-3xl sm:text-4xl font-semibold text-ink outline-none max-w-reading"
      >
        Let's build your style profile.
      </h1>
      <p className="mt-4 max-w-reading text-base text-muted leading-relaxed">
        Mila uses your coloring, silhouette, features, and preferences to create recommendations
        that are specific to you — not generic inspiration.
      </p>
      <p className="mt-2 max-w-reading text-sm text-muted leading-relaxed">
        It usually takes about five minutes. Your progress is saved as you go, and you can update
        your profile at any time from Style Profile.
      </p>

      <ul className="mt-8 grid gap-4 sm:grid-cols-3">
        {REASONS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="rounded-card border border-line bg-surface p-4">
            <Icon className="size-4 text-accent" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-ink">{title}</p>
            <p className="mt-1 text-xs text-muted leading-relaxed">{body}</p>
          </li>
        ))}
      </ul>

      <Button className="mt-8" size="lg" onClick={onBegin}>
        Begin my profile
        <ArrowRight className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
