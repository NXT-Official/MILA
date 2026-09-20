import { Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ClimateState } from "@/constants/climate";

const VIBES = [
  "Everyday Casual",
  "Work or School",
  "Business Casual",
  "Business Attire",
  "Brunch",
  "Date Night",
  "Dinner",
  "Party",
  "Formal Event",
  "Travel",
  "Active Day",
] as const;

export type Vibe = (typeof VIBES)[number];

export function HeroGeneratorForm({
  vibe,
  onVibeChange,
  agenda,
  onAgendaChange,
  dressCode,
  onDressCodeChange,
  indoorOutdoor,
  onIndoorOutdoorChange,
  climate,
  generating,
  profileComplete,
  blockedReason,
  onGenerate,
}: {
  vibe: Vibe;
  onVibeChange: (v: Vibe) => void;
  agenda: string;
  onAgendaChange: (v: string) => void;
  dressCode: string;
  onDressCodeChange: (v: string) => void;
  indoorOutdoor: "Indoor" | "Outdoor" | "Mixed" | "";
  onIndoorOutdoorChange: (v: "Indoor" | "Outdoor" | "Mixed") => void;
  climate: ClimateState | null;
  generating: boolean;
  profileComplete: boolean;
  blockedReason: string | null;
  onGenerate: () => void;
}) {
  return (
    <div className="mt-6 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span
            id="vibe-label"
            className="mb-2 block text-xs font-medium uppercase tracking-label text-muted-foreground"
          >
            Today's Mood
          </span>
          <Select value={vibe} onValueChange={(v) => onVibeChange(v as Vibe)}>
            <SelectTrigger
              aria-labelledby="vibe-label"
              className="h-11 rounded-full border-border bg-card text-sm"
            >
              <SelectValue placeholder="Select an occasion" />
            </SelectTrigger>
            <SelectContent>
              {VIBES.map((v) => (
                <SelectItem key={v} value={v} className="text-sm">
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label
            htmlFor="agenda-input"
            className="mb-2 block text-xs font-medium uppercase tracking-label text-muted-foreground"
          >
            Today's plan (optional)
          </label>
          <Input
            id="agenda-input"
            value={agenda}
            onChange={(e) => onAgendaChange(e.target.value)}
            placeholder="e.g. Client dinner at 7pm"
            maxLength={200}
            className="h-11 rounded-full border-border bg-card text-sm"
          />
        </div>
        <div>
          <label
            htmlFor="dress-code-input"
            className="mb-2 block text-xs font-medium uppercase tracking-label text-muted-foreground"
          >
            Dress code (optional)
          </label>
          <Input
            id="dress-code-input"
            value={dressCode}
            onChange={(e) => onDressCodeChange(e.target.value)}
            placeholder="e.g. Smart casual"
            maxLength={80}
            className="h-11 rounded-full border-border bg-card text-sm"
          />
        </div>
        <div>
          <span
            id="setting-label"
            className="mb-2 block text-xs font-medium uppercase tracking-label text-muted-foreground"
          >
            Setting (optional)
          </span>
          <Select
            value={indoorOutdoor || undefined}
            onValueChange={(v) => onIndoorOutdoorChange(v as "Indoor" | "Outdoor" | "Mixed")}
          >
            <SelectTrigger
              aria-labelledby="setting-label"
              className="h-11 rounded-full border-border bg-card text-sm"
            >
              <SelectValue placeholder="Indoor, outdoor, or mixed" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Indoor" className="text-sm">
                Indoor
              </SelectItem>
              <SelectItem value="Outdoor" className="text-sm">
                Outdoor
              </SelectItem>
              <SelectItem value="Mixed" className="text-sm">
                Mixed
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={onGenerate}
          disabled={generating || !profileComplete || !climate}
          aria-describedby={blockedReason ? "generate-blocked" : undefined}
          size="pill"
          className="w-full sm:w-auto whitespace-normal text-center leading-snug"
        >
          {generating ? (
            <>
              <Loader2 className="animate-spin" aria-hidden="true" /> Composing…
            </>
          ) : climate ? (
            <>
              <Wand2 className="text-accent" aria-hidden="true" /> Create my look — {climate.tempC}
              °C {climate.condition}
            </>
          ) : (
            <>
              <Wand2 className="text-accent" aria-hidden="true" /> Create my look
            </>
          )}
        </Button>
        {blockedReason && (
          <span id="generate-blocked" className="text-sm text-muted-foreground text-pretty">
            {blockedReason}
          </span>
        )}
      </div>
    </div>
  );
}
