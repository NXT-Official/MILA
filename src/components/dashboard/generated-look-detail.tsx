import type { ReactNode } from "react";
import { LookSection } from "@/components/dashboard/look-section";
import { ExpandableText } from "@/components/dashboard/expandable-text";
import type { DailyLook } from "@/lib/generate-outfit.functions";

/**
 * The two-column "image left, Outfit/Hair/Makeup right" layout shared by
 * the dashboard's live result and the History detail view, so a saved look
 * looks exactly like the moment it was generated. `media` is the image
 * area — callers own its loading/error/retry behavior since that differs
 * between a live generation and a permanently-saved record.
 */
export function GeneratedLookDetail({
  outfit,
  hair,
  makeup,
  media,
}: {
  outfit: DailyLook["outfit"];
  hair: DailyLook["hair"];
  makeup: DailyLook["makeup"];
  media: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[42fr_58fr] lg:gap-8">
      <div>{media}</div>
      <div className="space-y-4">
        <LookSection kicker="Outfit" title={outfit.headline}>
          <ExpandableText
            text={outfit.description}
            clampClassName="line-clamp-6"
            className="font-serif text-lg leading-relaxed text-foreground/90"
          />
          <div className="mt-3 border-t border-border/70 pt-3">
            <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-accent">Styling notes</p>
            <ExpandableText
              text={outfit.styling_notes}
              clampClassName="line-clamp-3"
              className="text-sm italic text-muted-foreground"
            />
          </div>
        </LookSection>
        <LookSection kicker="Hair">
          <ExpandableText
            text={hair.style}
            clampClassName="line-clamp-4"
            className="font-serif text-base leading-relaxed text-foreground/90"
          />
          <div className="mt-3 border-t border-border/70 pt-3">
            <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-accent">How to</p>
            <ExpandableText
              text={hair.execution_tip}
              clampClassName="line-clamp-2"
              className="text-sm text-muted-foreground"
            />
          </div>
        </LookSection>
        <LookSection kicker="Makeup">
          <ExpandableText
            text={makeup.palette}
            clampClassName="line-clamp-4"
            className="font-serif text-base leading-relaxed text-foreground/90"
          />
          <div className="mt-3 border-t border-border/70 pt-3">
            <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-accent">How to</p>
            <ExpandableText
              text={makeup.details}
              clampClassName="line-clamp-2"
              className="text-sm text-muted-foreground"
            />
          </div>
        </LookSection>
      </div>
    </div>
  );
}
