import { useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { OptionTile } from "@/components/ui/option-tile";
import { type BodyType, BODY_TYPE_INFO } from "@/constants/style-profile";
import {
  BALANCE_CHOICES,
  DRAPE_CHOICES,
  QUIZ_SAVE_ERROR,
  bodyTypeFromAnswers,
  saveQuizBodyType,
  type Balance,
  type Drape,
  type QuizChoice,
} from "@/lib/style-profile/body-quiz";
import { cn } from "@/lib/utils";
import { useModalA11y } from "@/hooks/use-modal-a11y";

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
  choices: readonly QuizChoice<T>[];
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
            className="text-xs uppercase rounded-none min-h-11"
          >
            <ArrowLeft className="size-3 mr-1" /> Back
          </Button>
        )}
        <Button
          disabled={!value}
          onClick={onNext}
          className="text-xs uppercase tracking-widest rounded-none h-11 px-6"
        >
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * The quiz's content for one step: the two questions, then her silhouette.
 * Stateless, so each step can be shown on its own (and tested without a DOM).
 */
export function BodyQuizPanel({
  step,
  drape,
  balance,
  saving,
  saveError,
  onDrape,
  onBalance,
  onStep,
  onStartOver,
  onConfirm,
}: {
  step: 1 | 2 | 3;
  drape: Drape | null;
  balance: Balance | null;
  saving: boolean;
  saveError: string | null;
  onDrape: (value: Drape) => void;
  onBalance: (value: Balance) => void;
  onStep: (step: 1 | 2 | 3) => void;
  onStartOver: () => void;
  onConfirm: () => void;
}) {
  const result = bodyTypeFromAnswers(drape, balance);

  if (step === 1) {
    return (
      <ChoiceStep
        title="How do your favorite blazers drape?"
        prompt="Pick the one that feels most like you when you put on a piece you love."
        choices={DRAPE_CHOICES}
        value={drape}
        onSelect={onDrape}
        onNext={() => onStep(2)}
        nextLabel="Continue"
      />
    );
  }

  if (step === 2) {
    return (
      <ChoiceStep
        title="Where do you naturally feel most balanced?"
        prompt="Think of yourself in your favorite jeans and a soft t-shirt."
        choices={BALANCE_CHOICES}
        value={balance}
        onSelect={onBalance}
        onBack={() => onStep(1)}
        onNext={() => onStep(3)}
        nextLabel="See your silhouette"
      />
    );
  }

  if (!result) return null;

  return (
    <div className="space-y-5 text-center">
      <p className="text-micro uppercase tracking-label-xwide text-muted-foreground">
        Your silhouette
      </p>
      <h3 className="font-serif text-3xl sm:text-4xl tracking-tight">{result}</h3>
      <p className="text-xs text-muted-foreground italic max-w-sm mx-auto">
        {BODY_TYPE_INFO[result].tagline}
      </p>
      <div className="text-left bg-muted/30 p-5 text-xs leading-relaxed text-muted-foreground border border-border rounded-none">
        {BODY_TYPE_INFO[result].description}
      </div>
      {saveError ? (
        <p role="alert" className="text-xs text-destructive">
          {saveError}
        </p>
      ) : null}
      <div className="flex gap-2 pt-2">
        <Button
          variant="ghost"
          onClick={onStartOver}
          className="flex-1 text-xs uppercase tracking-widest rounded-none h-11"
        >
          Start over
        </Button>
        <Button
          onClick={onConfirm}
          disabled={saving}
          className="flex-1 text-xs uppercase tracking-widest rounded-none h-11"
        >
          {saving ? "Saving…" : "That's me"}
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
  /** When set, the quiz saves her silhouette itself before it completes. */
  userId?: string;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [drape, setDrape] = useState<Drape | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useModalA11y({ containerRef, onClose });

  const result = bodyTypeFromAnswers(drape, balance);

  async function commit() {
    if (!result) return;
    if (userId) {
      setSaving(true);
      setSaveError(null);
      const saved = await saveQuizBodyType(
        (row) => supabase.from("profiles").upsert(row),
        userId,
        result,
      );
      setSaving(false);
      // Never close as if it saved: her result stays, with the reason.
      if (!saved) {
        setSaveError(QUIZ_SAVE_ERROR);
        return;
      }
    }
    onComplete(result);
    onClose();
  }

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Body type quiz"
      tabIndex={-1}
      className="fixed inset-0 z-50 bg-background flex items-center justify-center p-0 sm:p-4"
    >
      <div className="bg-card w-full sm:border sm:border-border max-w-xl h-full sm:h-auto sm:max-h-[90vh] overflow-y-auto p-6 sm:p-8 flex flex-col shadow-2xl">
        <div className="flex justify-between items-center pb-4 mb-6 border-b border-border/60">
          <p className="text-micro uppercase tracking-label-xwide text-muted-foreground">
            Step {step} of 3 · Find your silhouette
          </p>
          <button
            type="button"
            onClick={onClose}
            className="atelier-focus-ring -mr-3 min-h-11 min-w-11 px-3 text-micro uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            Close
          </button>
        </div>

        <BodyQuizPanel
          step={step}
          drape={drape}
          balance={balance}
          saving={saving}
          saveError={saveError}
          onDrape={setDrape}
          onBalance={setBalance}
          onStep={setStep}
          onStartOver={() => {
            setStep(1);
            setDrape(null);
            setBalance(null);
            setSaveError(null);
          }}
          onConfirm={commit}
        />
      </div>
    </div>
  );
}
