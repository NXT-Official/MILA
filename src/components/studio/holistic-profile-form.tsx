import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  FACE_SHAPES,
  HAIR_TYPES,
  updateHolisticProfile,
} from "@/lib/profile.functions";
import { cn } from "@/lib/utils";

const schema = z.object({
  face_shape: z.enum(FACE_SHAPES, { message: "Select a face shape" }),
  hair_type: z.enum(HAIR_TYPES, { message: "Select a hair type" }),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  userId: string;
  initial: { face_shape: string | null; hair_type: string | null };
}

export function HolisticProfileForm({ userId, initial }: Props) {
  const qc = useQueryClient();
  const saveFn = useServerFn(updateHolisticProfile);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      face_shape: (initial.face_shape as FormValues["face_shape"]) ?? undefined,
      hair_type: (initial.hair_type as FormValues["hair_type"]) ?? undefined,
    },
  });

  useEffect(() => {
    form.reset({
      face_shape: (initial.face_shape as FormValues["face_shape"]) ?? undefined,
      hair_type: (initial.hair_type as FormValues["hair_type"]) ?? undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.face_shape, initial.hair_type]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => saveFn({ data: values }),
    onSuccess: () => {
      toast.success("Your holistic profile is saved.");
      qc.invalidateQueries({ queryKey: ["profile", userId] });
      qc.invalidateQueries({ queryKey: ["holistic-profile", userId] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    },
  });

  const faceShape = form.watch("face_shape");
  const hairType = form.watch("hair_type");

  return (
    <form
      onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
      className="bg-background/75 backdrop-blur-xl p-8 rounded-3xl border border-porcelain/40 shadow-atelier-soft space-y-8"
    >
      <div className="text-center space-y-2">
        <span className="text-[10px] uppercase tracking-[0.32em] text-stone block">
          Holistic Profile
        </span>
        <h3 className="font-serif text-2xl text-ink tracking-wide">
          Face & Hair Signature
        </h3>
        <p className="text-sm text-stone max-w-md mx-auto">
          These details refine how Mila curates makeup, hair, and silhouette
          guidance for your daily looks.
        </p>
      </div>

      {/* Face Shape */}
      <div className="space-y-3">
        <label className="text-xs uppercase tracking-[0.2em] text-ink font-medium block">
          Face Shape
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {FACE_SHAPES.map((shape) => {
            const active = faceShape === shape;
            return (
              <button
                key={shape}
                type="button"
                onClick={() =>
                  form.setValue("face_shape", shape, { shouldDirty: true, shouldValidate: true })
                }
                className={cn(
                  "px-3 py-3 text-left rounded-xl border transition-all duration-300",
                  active
                    ? "bg-white border-stone/40 shadow-atelier-soft -translate-y-[1px]"
                    : "border-stone/10 bg-porcelain/30 hover:bg-white hover:border-stone/30"
                )}
              >
                <span className="text-[11px] uppercase tracking-[0.22em] text-ink flex items-center justify-between gap-2">
                  {shape}
                  {active && <Check className="h-3 w-3" />}
                </span>
              </button>
            );
          })}
        </div>
        {form.formState.errors.face_shape && (
          <p className="text-[11px] text-destructive">
            {form.formState.errors.face_shape.message}
          </p>
        )}
      </div>

      {/* Hair Type */}
      <div className="space-y-3 pt-4 border-t border-porcelain/40">
        <label className="text-xs uppercase tracking-[0.2em] text-ink font-medium block">
          Hair Type
        </label>
        <div className="grid grid-cols-2 gap-2">
          {HAIR_TYPES.map((hair) => {
            const active = hairType === hair;
            return (
              <button
                key={hair}
                type="button"
                onClick={() =>
                  form.setValue("hair_type", hair, { shouldDirty: true, shouldValidate: true })
                }
                className={cn(
                  "px-3 py-3 text-left rounded-xl border transition-all duration-300",
                  active
                    ? "bg-white border-stone/40 shadow-atelier-soft -translate-y-[1px]"
                    : "border-stone/10 bg-porcelain/30 hover:bg-white hover:border-stone/30"
                )}
              >
                <span className="text-[11px] uppercase tracking-[0.22em] text-ink flex items-center justify-between gap-2">
                  {hair}
                  {active && <Check className="h-3 w-3" />}
                </span>
              </button>
            );
          })}
        </div>
        {form.formState.errors.hair_type && (
          <p className="text-[11px] text-destructive">
            {form.formState.errors.hair_type.message}
          </p>
        )}
      </div>

      <div className="flex justify-center pt-2">
        <Button
          type="submit"
          disabled={mutation.isPending || !form.formState.isDirty}
          className="text-xs uppercase tracking-widest h-11 px-8 rounded-none bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40"
        >
          {mutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5 mr-2" />
          )}
          Save Holistic Profile
        </Button>
      </div>
    </form>
  );
}