import { Reveal } from "@/components/landing/reveal";
import { SeasonTag } from "@/components/landing/season-tag";

export function DossierSection() {
  return (
    <Reveal className="mx-auto grid w-full max-w-6xl items-center gap-10 px-6 pb-24 lg:grid-cols-2">
      <div>
        <p className="atelier-kicker">The Style Dossier</p>
        <h2 className="mt-2 font-serif">The more Mila knows you, the better she dresses you.</h2>
        <p className="mt-4 max-w-md text-sm leading-relaxed">
          Your dossier is a living profile — colour season, body silhouette, face shape, hair
          texture, beauty preferences. Every recommendation is anchored to it, and it gets more
          precise every day you use it.
        </p>
      </div>

      <div className="atelier-card p-7">
        <div className="flex items-center justify-between">
          <span className="font-serif text-lg text-foreground">Digital Style Dossier</span>
          <SeasonTag season="True Summer" />
        </div>

        <div className="mt-5 space-y-3 text-sm">
          {[
            ["Colour season", "True Summer — cool, muted, soft"],
            ["Silhouette", "Inverted triangle"],
            ["Beauty profile", "Wavy hair · warm-neutral skin"],
          ].map(([key, value]) => (
            <div key={key} className="flex justify-between gap-4 border-b border-border pb-3">
              <span className="text-muted-foreground">{key}</span>
              <span className="text-right text-foreground">{value}</span>
            </div>
          ))}
        </div>

        <div className="mt-5">
          <div className="flex justify-between text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            <span>Dossier completion</span>
            <span>80%</span>
          </div>

          <div className="mt-2 h-1.5 rounded-full bg-border">
            <div className="h-full w-4/5 rounded-full bg-accent" />
          </div>
        </div>
      </div>
    </Reveal>
  );
}
