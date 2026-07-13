import { useEffect, useRef } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { FormField } from "@/components/ui/form-field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  adminCreateSubscriptionPlan,
  adminUpdateSubscriptionPlan,
} from "@/lib/subscription-plans.functions";
import {
  BILLING_INTERVALS,
  BILLING_INTERVAL_LABELS,
  centsToPriceInput,
  parsePriceToCents,
  planSlugSchema,
  slugifyPlanTitle,
  type SubscriptionPlan,
} from "@/lib/subscription-plans";

const formSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required.")
    .max(80, "Keep the title under 80 characters."),
  slug: planSlugSchema,
  description: z.string().trim().max(280, "Keep the description under 280 characters."),
  price: z
    .string()
    .trim()
    .refine((v) => parsePriceToCents(v) !== null, "Enter a price like 14.99 (max 9,999,999)."),
  currency: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{3}$/, "Use a 3-letter currency code, e.g. usd."),
  billing_interval: z.enum(BILLING_INTERVALS),
  credits_included: z.coerce
    .number({ invalid_type_error: "Enter a whole number." })
    .int("Enter a whole number.")
    .min(0, "Credits can't be negative.")
    .max(1_000_000),
  sort_order: z.coerce
    .number({ invalid_type_error: "Enter a whole number." })
    .int("Enter a whole number.")
    .min(0, "Sort order can't be negative.")
    .max(9999),
  features: z
    .string()
    .refine((v) => splitFeatures(v).length <= 12, "At most 12 features.")
    .refine(
      (v) => splitFeatures(v).every((f) => f.length <= 120),
      "Keep each feature under 120 characters.",
    ),
  is_active: z.boolean(),
  is_featured: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

function splitFeatures(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

interface SubscriptionPlanFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present for edit mode; omitted when creating a new plan. */
  plan?: SubscriptionPlan;
  /** Prefilled sort order for a newly created plan (end of the list). */
  nextSortOrder: number;
  onSaved: () => void;
}

export function SubscriptionPlanFormDialog({
  open,
  onOpenChange,
  plan,
  nextSortOrder,
  onSaved,
}: SubscriptionPlanFormDialogProps) {
  const isEdit = !!plan;
  const createPlan = useServerFn(adminCreateSubscriptionPlan);
  const updatePlan = useServerFn(adminUpdateSubscriptionPlan);
  // Auto-generate the slug from the title only until the admin touches the
  // slug field (and never when editing an existing plan).
  const slugEdited = useRef(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyValues(nextSortOrder),
  });

  useEffect(() => {
    if (!open) return;
    slugEdited.current = isEdit;
    reset(
      plan
        ? {
            title: plan.title,
            slug: plan.slug,
            description: plan.description,
            price: centsToPriceInput(plan.price_amount),
            currency: plan.currency,
            billing_interval: plan.billing_interval,
            credits_included: plan.credits_included,
            sort_order: plan.sort_order,
            features: plan.features.join("\n"),
            is_active: plan.is_active,
            is_featured: plan.is_featured,
          }
        : emptyValues(nextSortOrder),
    );
  }, [open, plan, isEdit, nextSortOrder, reset]);

  const titleField = register("title");
  const slugField = register("slug");

  const onSubmit = async (values: FormValues) => {
    const payload = {
      title: values.title,
      slug: values.slug,
      description: values.description,
      // Validated by the refine above; parse from the string form to avoid
      // float multiplication drift.
      price_amount: parsePriceToCents(values.price) ?? 0,
      currency: values.currency,
      billing_interval: values.billing_interval,
      credits_included: values.credits_included,
      sort_order: values.sort_order,
      features: splitFeatures(values.features),
      is_active: values.is_active,
      is_featured: values.is_featured,
    };
    try {
      if (isEdit) {
        await updatePlan({ data: { id: plan.id, ...payload } });
        toast.success("Plan updated.");
      } else {
        await createPlan({ data: payload });
        toast.success("Plan created.");
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      // Keep the dialog open with the entered values so nothing is lost.
      toast.error(err instanceof Error ? err.message : "Couldn't save the plan.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif">{isEdit ? "Edit Plan" : "Create Plan"}</DialogTitle>
          <DialogDescription className="text-xs">
            {isEdit
              ? "Update this subscription plan. Changes to active plans are visible to members immediately."
              : "New plans start where you set the Active switch — leave it off to prepare a draft."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <FormField label="Title" htmlFor="plan-title" required error={errors.title?.message}>
            <Input
              id="plan-title"
              {...titleField}
              onChange={(e) => {
                titleField.onChange(e);
                if (!slugEdited.current) {
                  setValue("slug", slugifyPlanTitle(e.target.value), { shouldValidate: false });
                }
              }}
            />
          </FormField>

          <FormField
            label="Slug"
            htmlFor="plan-slug"
            required
            error={errors.slug?.message}
            description="Stable identifier used by application code. Don't change it casually on an existing plan."
          >
            <Input
              id="plan-slug"
              {...slugField}
              onChange={(e) => {
                slugEdited.current = true;
                slugField.onChange(e);
              }}
            />
          </FormField>

          <FormField
            label="Description"
            htmlFor="plan-description"
            error={errors.description?.message}
          >
            <Textarea id="plan-description" rows={2} {...register("description")} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Price" htmlFor="plan-price" required error={errors.price?.message}>
              <Input
                id="plan-price"
                inputMode="decimal"
                placeholder="14.99"
                {...register("price")}
              />
            </FormField>
            <FormField
              label="Currency"
              htmlFor="plan-currency"
              required
              error={errors.currency?.message}
            >
              <Input id="plan-currency" maxLength={3} {...register("currency")} />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-interval">Billing Interval</Label>
              <Controller
                control={control}
                name="billing_interval"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="plan-interval" className="h-11">
                      <SelectValue placeholder="Select interval" />
                    </SelectTrigger>
                    <SelectContent>
                      {BILLING_INTERVALS.map((interval) => (
                        <SelectItem key={interval} value={interval}>
                          {BILLING_INTERVAL_LABELS[interval]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <FormField
              label="Credits Included"
              htmlFor="plan-credits"
              error={errors.credits_included?.message}
            >
              <Input id="plan-credits" type="number" min={0} {...register("credits_included")} />
            </FormField>
          </div>

          <FormField
            label="Features"
            htmlFor="plan-features"
            error={errors.features?.message}
            description="One feature per line, shown as public bullet points."
          >
            <Textarea id="plan-features" rows={3} {...register("features")} />
          </FormField>

          <div className="grid grid-cols-3 gap-3 items-end">
            <FormField
              label="Sort Order"
              htmlFor="plan-sort-order"
              error={errors.sort_order?.message}
            >
              <Input id="plan-sort-order" type="number" min={0} {...register("sort_order")} />
            </FormField>
            <div className="flex items-center gap-2 pb-3">
              <Controller
                control={control}
                name="is_active"
                render={({ field }) => (
                  <Switch id="plan-active" checked={field.value} onCheckedChange={field.onChange} />
                )}
              />
              <Label htmlFor="plan-active">Active</Label>
            </div>
            <div className="flex items-center gap-2 pb-3">
              <Controller
                control={control}
                name="is_featured"
                render={({ field }) => (
                  <Switch
                    id="plan-featured"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <Label htmlFor="plan-featured">Featured</Label>
            </div>
          </div>
          <p className="text-xs text-muted">
            Featuring this plan automatically unfeatures any other plan.
          </p>

          <DialogFooter className="pt-1">
            <Button type="submit" loading={isSubmitting} size="sm">
              {isEdit ? "Save Changes" : "Create Plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function emptyValues(nextSortOrder: number): FormValues {
  return {
    title: "",
    slug: "",
    description: "",
    price: "",
    currency: "usd",
    billing_interval: "monthly",
    credits_included: 0,
    sort_order: nextSortOrder,
    features: "",
    is_active: false,
    is_featured: false,
  };
}
