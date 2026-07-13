import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CardMatrix } from "@/components/style-profile/shared";
import { StepFooter } from "@/components/onboarding/step-shell";
import type { MatrixOption } from "@/constants/style-profile";

/** Shared shell for a single required-choice step (body type / face shape / hair type). */
export function SingleSelectStep({
  fieldLabel,
  value,
  options,
  guidance,
  requiredMessage,
  onBack,
  onSaved,
  save,
}: {
  fieldLabel: string;
  value: string | null;
  options: MatrixOption[];
  guidance?: string;
  requiredMessage: string;
  onBack?: () => void;
  onSaved: () => void;
  save: (value: string) => Promise<void>;
}) {
  const allowed = options.map((o) => o.value) as [string, ...string[]];
  const schema = z.object({ value: z.enum(allowed, { message: requiredMessage }) });
  const form = useForm<{ value: string }>({
    resolver: zodResolver(schema),
    defaultValues: { value: value ?? "" },
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selected = form.watch("value");

  async function onSubmit(data: { value: string }) {
    setSaveError(null);
    setSaving(true);
    try {
      await save(data.value);
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "We couldn't save this step.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      {guidance ? (
        <p className="mb-6 max-w-reading text-sm text-muted leading-relaxed">{guidance}</p>
      ) : null}
      <CardMatrix
        label={fieldLabel}
        value={selected ?? ""}
        onPick={(v) => form.setValue("value", v, { shouldValidate: true, shouldDirty: true })}
        options={options}
      />
      {form.formState.errors.value ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {form.formState.errors.value.message}
        </p>
      ) : null}
      {saveError ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          We couldn't save this step. Your selection is still here — try again when you're ready.
        </p>
      ) : null}
      <StepFooter
        onBack={onBack}
        continueType="submit"
        continueLoading={saving}
        saveStatus={saving ? "saving" : saveError ? "error" : "idle"}
        onRetrySave={form.handleSubmit(onSubmit)}
      />
    </form>
  );
}
