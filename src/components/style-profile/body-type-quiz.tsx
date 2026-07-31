import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { OptionTile } from "@/components/ui/option-tile";
import { type BodyType, BODY_TYPE_INFO } from "@/constants/style-profile";
import { cn } from "@/lib/utils";

type Drape = "structured" | "waist" | "relaxed";
type Balance = "aligned" | "hips" | "upper";

const BODY_BY_ANSWER: Record<Drape, Record<Balance, BodyType>> = {
  structured: { aligned: "Inverted Triangle", upper: "Inverted Triangle", hips: "Hourglass" },
  waist: { aligned: "Hourglass", upper: "Hourglass", hips: "Pear" },
  relaxed: { aligned: "Rectangle", upper: "Rectangle", hips: "Pear" },
};

const DRAPE_CHOICES: { value: Drape; label: string; hint: string }[] = [
  {
    value: "structured",
    label: "Structured at the shoulders",
    hint: "The jacket holds its line up top.",
  },
  { value: "waist", label: "Form-fitting at the waist", hint: "It draws in just below the ribs." },
  { value: "relaxed", label: "Relaxed all over", hint: "It falls in a straight, easy line." },
];

const BALANCE_CHOICES: { value: Balance; label: string; hint: string }[] = [
  { value: "aligned", label: "Shoulders and hips align", hint: "Mirrored top and bottom." },
  { value: "hips", label: "Curving at the hips", hint: "More softness through the lower half." },
  { value: "upper", label: "Stronger upper frame", hint: "Presence sits across the shoulders." },
];

function ChoiceStep<T extends string>({
  title,
  prompt,
  choices,
  value,
  onSelect,
  onBack,
  onNext,
  nextLabel,
}: {
  title: string;
  prompt: string;
  choices: { value: T; label: string; hint: string }[];
  value: T | null;
  onSelect: (value: T) => void;
  onBack?: () => void;
  onNext: () => void;
  nextLabel: string;
}) {
  return (
    <div className="space-y-5">
      <div className="text-center">
        <h3 className="font-serif text-2xl sm:text-3xl tracking-tight">{title}</h3>
        <p className="text-xs text-muted-foreground mt-2 max-w-xs mx-auto leading-relaxed">
          {prompt}
        </p>
      </div>
      <div className="space-y-2.5">
        {choices.map((c) => (
          <OptionTile
            key={c.value}
            selected={value === c.value}
            onClick={() => onSelect(c.value)}
            className="border p-4 sm:p-5"
          >
            <p className="text-sm font-medium">{c.label}</p>
            <p className="text-label text-muted-foreground mt-1 leading-relaxed">{c.hint}</p>
          </OptionTile>
        ))}
      </div>
      <div className={cn("flex pt-2", onBack ? "justify-between" : "justify-end")}>
        {onBack && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="text-xs uppercase rounded-none"
          >
            <ArrowLeft className="size-3 mr-1" /> Back
          </Button>
        )}
        <Button
          disabled={!value}
          onClick={onNext}
          className="text-xs uppercase tracking-widest rounded-none h-10 px-6"
        >
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}

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

  const result = drape && balance ? BODY_BY_ANSWER[drape][balance] : null;

  async function commit() {
    if (!result) return;
    if (userId) {
      setSaving(true);
      await supabase
        .from("profiles")
        .upsert({ id: userId, body_type: result, updated_at: new Date().toISOString() });
      setSaving(false);
    }
    onComplete(result);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-background flex items-center justify-center p-0 sm:p-4">
      <div className="bg-card w-full sm:border sm:border-border max-w-xl h-full sm:h-auto sm:max-h-[90vh] overflow-y-auto p-6 sm:p-8 flex flex-col shadow-2xl">
        <div className="flex justify-between items-center pb-4 mb-6 border-b border-border/60">
          <p className="text-micro uppercase tracking-label-xwide text-accent">
            Step {step} of 3 · Find your silhouette
          </p>
          <button
            onClick={onClose}
            className="text-micro uppercase tracking-widest text-accent hover:text-foreground transition-colors"
          >
            Close
          </button>
        </div>

        {step === 1 && (
          <ChoiceStep
            title="How do your favorite blazers drape?"
            prompt="Pick the one that feels most like you when you put on a piece you love."
            choices={DRAPE_CHOICES}
            value={drape}
            onSelect={setDrape}
            onNext={() => setStep(2)}
            nextLabel="Continue"
          />
        )}

        {step === 2 && (
          <ChoiceStep
            title="Where do you naturally feel most balanced?"
            prompt="Think of yourself in your favorite jeans and a soft t-shirt."
            choices={BALANCE_CHOICES}
            value={balance}
            onSelect={setBalance}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
            nextLabel="See your silhouette"
          />
        )}

        {step === 3 && result && (
          <div className="space-y-5 text-center">
            <p className="text-micro uppercase tracking-label-xwide text-accent">Your silhouette</p>
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
