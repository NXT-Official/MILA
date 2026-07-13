import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { type BodyType, BODY_TYPE_INFO } from "@/constants/style-profile";

export type Drape = "structured" | "waist" | "relaxed";
export type Balance = "aligned" | "hips" | "upper";

export function resolveBodyFromQuiz(drape: Drape, balance: Balance): BodyType {
  if (drape === "waist") {
    if (balance === "hips") return "Pear";
    return "Hourglass";
  }
  if (drape === "structured") {
    if (balance === "hips") return "Hourglass";
    return "Inverted Triangle";
  }
  if (balance === "hips") return "Pear";
  return "Rectangle";
}

export const DRAPE_CHOICES: { value: Drape; label: string; hint: string }[] = [
  {
    value: "structured",
    label: "Structured at the shoulders",
    hint: "The jacket holds its line up top.",
  },
  { value: "waist", label: "Form-fitting at the waist", hint: "It draws in just below the ribs." },
  { value: "relaxed", label: "Relaxed all over", hint: "It falls in a straight, easy line." },
];

export const BALANCE_CHOICES: { value: Balance; label: string; hint: string }[] = [
  { value: "aligned", label: "Shoulders and hips align", hint: "Mirrored top and bottom." },
  { value: "hips", label: "Curving at the hips", hint: "More softness through the lower half." },
  { value: "upper", label: "Stronger upper frame", hint: "Presence sits across the shoulders." },
];

export function BodyTypeQuiz({
  onClose,
  onComplete,
  userId,
}: {
  onClose: () => void;
  onComplete: (bodyType: BodyType) => void;
  userId?: string;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [drape, setDrape] = useState<Drape | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [saving, setSaving] = useState(false);

  const result: BodyType | null = drape && balance ? resolveBodyFromQuiz(drape, balance) : null;

  async function commit() {
    if (!result) return;
    if (userId) {
      setSaving(true);
      await supabase
        .from("profiles")
        .upsert({ id: userId, body_type: result, updated_at: new Date().toISOString() } as any);
      setSaving(false);
    }
    onComplete(result);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-background flex items-center justify-center p-0 sm:p-4">
      <div className="bg-card w-full sm:border sm:border-border max-w-xl h-full sm:h-auto sm:max-h-[90vh] overflow-y-auto p-6 sm:p-8 flex flex-col shadow-2xl">
        <div className="flex justify-between items-center pb-4 mb-6 border-b border-border/60">
          <p className="text-[10px] uppercase tracking-[0.32em] text-accent">
            Step {step} of 3 · Find your silhouette
          </p>
          <button
            onClick={onClose}
            className="text-[10px] uppercase tracking-widest text-accent hover:text-foreground transition-colors"
          >
            Close
          </button>
        </div>

        {step === 1 && (
          <div className="space-y-5 animate-fade-in">
            <div className="text-center">
              <h3 className="font-serif text-2xl sm:text-3xl tracking-tight">
                How do your favorite blazers drape?
              </h3>
              <p className="text-xs text-muted-foreground mt-2 max-w-xs mx-auto leading-relaxed">
                Pick the one that feels most like you when you put on a piece you love.
              </p>
            </div>
            <div className="space-y-2.5">
              {DRAPE_CHOICES.map((c) => {
                const active = drape === c.value;
                return (
                  <button
                    key={c.value}
                    onClick={() => setDrape(c.value)}
                    className={`w-full text-left border p-4 sm:p-5 rounded-none transition-all ${active ? "border-foreground bg-foreground/4" : "border-border hover:border-foreground/40"}`}
                  >
                    <p className="text-sm font-medium">{c.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                      {c.hint}
                    </p>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end pt-2">
              <Button
                disabled={!drape}
                onClick={() => setStep(2)}
                className="text-xs uppercase tracking-widest rounded-none h-10 px-6"
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5 animate-fade-in">
            <div className="text-center">
              <h3 className="font-serif text-2xl sm:text-3xl tracking-tight">
                Where do you naturally feel most balanced?
              </h3>
              <p className="text-xs text-muted-foreground mt-2 max-w-xs mx-auto leading-relaxed">
                Think of yourself in your favorite jeans and a soft t-shirt.
              </p>
            </div>
            <div className="space-y-2.5">
              {BALANCE_CHOICES.map((c) => {
                const active = balance === c.value;
                return (
                  <button
                    key={c.value}
                    onClick={() => setBalance(c.value)}
                    className={`w-full text-left border p-4 sm:p-5 rounded-none transition-all ${active ? "border-foreground bg-foreground/4" : "border-border hover:border-foreground/40"}`}
                  >
                    <p className="text-sm font-medium">{c.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                      {c.hint}
                    </p>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep(1)}
                className="text-xs uppercase rounded-none"
              >
                <ArrowLeft className="size-3 mr-1" /> Back
              </Button>
              <Button
                disabled={!balance}
                onClick={() => setStep(3)}
                className="text-xs uppercase tracking-widest rounded-none h-10 px-6"
              >
                See your silhouette
              </Button>
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div className="space-y-5 text-center animate-fade-in">
            <p className="text-[10px] uppercase tracking-[0.32em] text-accent">Your silhouette</p>
            <h3 className="font-serif text-3xl sm:text-4xl tracking-tight">{result}</h3>
            <p className="text-xs text-muted-foreground italic max-w-sm mx-auto">
              {BODY_TYPE_INFO[result].tagline}
            </p>
            <div className="text-left bg-muted/30 p-5 text-xs leading-relaxed text-muted-foreground border border-border rounded-none">
              {BODY_TYPE_INFO[result].description}
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setStep(1);
                  setDrape(null);
                  setBalance(null);
                }}
                className="flex-1 text-xs uppercase tracking-widest rounded-none h-11"
              >
                Start over
              </Button>
              <Button
                onClick={commit}
                disabled={saving}
                className="flex-1 text-xs uppercase tracking-widest rounded-none h-11"
              >
                {saving ? "Saving…" : "That's me"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
