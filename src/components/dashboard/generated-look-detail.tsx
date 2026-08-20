import type { ReactNode } from "react";
import { LookSection } from "@/components/dashboard/look-section";
import { ExpandableText } from "@/components/dashboard/expandable-text";
import type { DailyLook } from "@/lib/generate-outfit.functions";

const SUB_LABEL = "mb-1 text-xs font-semibold text-foreground";

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
    <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[42fr_58fr] md:gap-8">
      <div>{media}</div>
      <div className="space-y-6">
        {/* The outfit line is the one editorial moment; hair and makeup are
            supporting copy and stay in the body face. */}
        <LookSection label="Outfit" title={outfit.headline}>
          <ExpandableText
            text={outfit.description}
            clampClassName="line-clamp-6"
            className="font-serif text-lg leading-relaxed text-foreground/90"
          />
          <div className="mt-4">
            <p className={SUB_LABEL}>Styling notes</p>
            <ExpandableText
              text={outfit.styling_notes}
              clampClassName="line-clamp-3"
              className="text-sm text-muted-foreground"
            />
          </div>
        </LookSection>
        <LookSection label="Hair">
          <ExpandableText
            text={hair.style}
            clampClassName="line-clamp-4"
            className="text-base leading-relaxed text-foreground/90"
          />
          <div className="mt-4">
            <p className={SUB_LABEL}>How to</p>
            <ExpandableText
              text={hair.execution_tip}
              clampClassName="line-clamp-2"
              className="text-sm text-muted-foreground"
            />
          </div>
        </LookSection>
        <LookSection label="Makeup">
          <ExpandableText
            text={makeup.palette}
            clampClassName="line-clamp-4"
            className="text-base leading-relaxed text-foreground/90"
          />
          <div className="mt-4">
            <p className={SUB_LABEL}>How to</p>
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
