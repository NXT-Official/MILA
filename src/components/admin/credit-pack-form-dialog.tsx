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
import { adminCreateCreditPack, adminUpdateCreditPack } from "@/lib/credit-packs.functions";
import {
  planSlugSchema,
  slugifyPlanTitle,
  centsToPriceInput,
  parsePriceToCents,
} from "@/lib/subscription-plans";
import type { CreditPack } from "@/lib/credit-packs";

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
    .refine((v) => parsePriceToCents(v) !== null, "Enter a price like 1.99 (max 9,999,999)."),
  currency: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{3}$/, "Use a 3-letter currency code, e.g. usd."),
  credits: z.coerce
    .number({ invalid_type_error: "Enter a whole number." })
    .int("Enter a whole number.")
    .min(1, "Credits must be at least 1.")
    .max(1_000_000),
  sort_order: z.coerce
    .number({ invalid_type_error: "Enter a whole number." })
    .int("Enter a whole number.")
    .min(0, "Sort order can't be negative.")
    .max(9999),
  is_active: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

interface CreditPackFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pack?: CreditPack;
  nextSortOrder: number;
  onSaved: () => void;
}

export function CreditPackFormDialog({
  open,
  onOpenChange,
  pack,
  nextSortOrder,
  onSaved,
}: CreditPackFormDialogProps) {
  const isEdit = !!pack;
  const createPack = useServerFn(adminCreateCreditPack);
  const updatePack = useServerFn(adminUpdateCreditPack);
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
      pack
        ? {
            title: pack.title,
            slug: pack.slug,
            description: pack.description,
            price: centsToPriceInput(pack.price_amount),
            currency: pack.currency,
            credits: pack.credits,
            sort_order: pack.sort_order,
            is_active: pack.is_active,
          }
        : emptyValues(nextSortOrder),
    );
  }, [open, pack, isEdit, nextSortOrder, reset]);

  const titleField = register("title");
  const slugField = register("slug");

  const onSubmit = async (values: FormValues) => {
    const payload = {
      title: values.title,
      slug: values.slug,
      description: values.description,
      price_amount: parsePriceToCents(values.price) ?? 0,
      currency: values.currency,
      credits: values.credits,
      sort_order: values.sort_order,
      is_active: values.is_active,
    };
    try {
      if (isEdit) {
        await updatePack({ data: { id: pack.id, ...payload } });
        toast.success("Pack updated.");
      } else {
        await createPack({ data: payload });
        toast.success("Pack created.");
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the pack.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif">
            {isEdit ? "Edit Credit Pack" : "Create Credit Pack"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isEdit
              ? "Update this credit pack. Changes to active packs are visible to members immediately."
              : "New packs start where you set the Active switch — leave it off to prepare a draft. After creating it, set its Paddle price ID directly in the database once the matching one-time Price exists in Paddle."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <FormField label="Title" htmlFor="pack-title" required error={errors.title?.message}>
            <Input
              id="pack-title"
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
            htmlFor="pack-slug"
            required
            error={errors.slug?.message}
            description="Stable identifier used by application code. Don't change it casually on an existing pack."
          >
            <Input
              id="pack-slug"
              {...slugField}
              onChange={(e) => {
                slugEdited.current = true;
                slugField.onChange(e);
              }}
            />
          </FormField>

          <FormField
            label="Description"
            htmlFor="pack-description"
            error={errors.description?.message}
          >
            <Textarea id="pack-description" rows={2} {...register("description")} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Price" htmlFor="pack-price" required error={errors.price?.message}>
              <Input
                id="pack-price"
                inputMode="decimal"
                placeholder="1.99"
                {...register("price")}
              />
            </FormField>
            <FormField
              label="Currency"
              htmlFor="pack-currency"
              required
              error={errors.currency?.message}
            >
              <Input id="pack-currency" maxLength={3} {...register("currency")} />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Credits"
              htmlFor="pack-credits"
              required
              error={errors.credits?.message}
            >
              <Input id="pack-credits" type="number" min={1} {...register("credits")} />
            </FormField>
            <FormField
              label="Sort Order"
              htmlFor="pack-sort-order"
              error={errors.sort_order?.message}
            >
              <Input id="pack-sort-order" type="number" min={0} {...register("sort_order")} />
            </FormField>
          </div>

          <div className="flex items-center gap-2">
            <Controller
              control={control}
              name="is_active"
              render={({ field }) => (
                <Switch id="pack-active" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
            <Label htmlFor="pack-active">Active</Label>
          </div>

          <DialogFooter className="pt-1">
            <Button type="submit" loading={isSubmitting} size="sm">
              {isEdit ? "Save Changes" : "Create Pack"}
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
    credits: 10,
    sort_order: nextSortOrder,
    is_active: false,
  };
}
