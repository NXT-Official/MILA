import { Check } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { MANUAL_SEASON_GROUPS, SEASONS_MASTER_DATA } from "@/constants/style-profile";

export function SeasonCalibrationSheet({
  open,
  onOpenChange,
  activeSeason,
  activeSubSeason,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeSeason: string;
  activeSubSeason: string;
  onApply: (key: keyof typeof SEASONS_MASTER_DATA, label: string) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="bg-ink text-surface border-t border-surface/10 rounded-t-2xl max-h-[85vh] overflow-y-auto"
      >
        <SheetHeader className="text-left">
          <p className="text-nano uppercase tracking-label-max text-surface/50">Seoul Atelier</p>
          <SheetTitle className="font-serif text-2xl tracking-tight text-surface">
            Already know your seasonal palette? Choose your look below.
          </SheetTitle>
          <SheetDescription className="text-label text-surface/60 leading-relaxed">
            Cameras can read light and shadow differently than the eye. Tap your true sub-season —
            your palette, beauty notes, and colors to avoid will update from the atelier library,
            and your confidence chip will lock to 100% Studio Tuned.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-7 pb-6">
          {MANUAL_SEASON_GROUPS.map((group) => (
            <div key={group.season}>
              <div className="flex items-center gap-3">
                <span className="h-px w-6 bg-surface/30" />
                <p className="text-micro uppercase tracking-label-max text-surface/70">
                  {group.season}
                </p>
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                {group.keys.map((k) => {
                  const active =
                    activeSeason === group.season &&
                    SEASONS_MASTER_DATA[k.key].subSeason === activeSubSeason;
                  return (
                    <button
                      key={k.key}
                      type="button"
                      onClick={() => onApply(k.key, k.label)}
                      className={`group text-left border px-4 py-3 transition-colors ${
                        active
                          ? "border-surface bg-surface/10"
                          : "border-surface/15 hover:border-surface/60 bg-surface/2 hover:bg-surface/6"
                      }`}
                    >
                      <p className="text-label uppercase tracking-label-wide text-surface flex items-center justify-between gap-2">
                        {k.label}
                        {active && <Check className="size-3 text-surface/80" />}
                      </p>
                      <p className="mt-1 text-micro text-surface/55 leading-relaxed line-clamp-2">
                        {SEASONS_MASTER_DATA[k.key].subSeason}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
