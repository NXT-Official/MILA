import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * A pickable answer in a quiz or onboarding step. Padding stays at the call
 * site — it genuinely varies (p-3 through p-5) and tailwind-merge resolves it.
 * `selected` only affects the flat variant; nothing selects a card tile yet.
 */
const optionTileVariants = cva("w-full text-left transition-all", {
  variants: {
    variant: {
      flat: "rounded-none border-[0.5px]",
      card: "atelier-focus-ring rounded-card border border-line bg-surface transition-colors hover:border-accent",
    },
    selected: { true: "", false: "" },
  },
  compoundVariants: [
    { variant: "flat", selected: false, class: "border-border hover:border-foreground/40" },
    { variant: "flat", selected: true, class: "border-foreground bg-foreground/4" },
  ],
  defaultVariants: { variant: "flat", selected: false },
});

export interface OptionTileProps
  extends
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type">,
    VariantProps<typeof optionTileVariants> {}

export function OptionTile({ variant, selected, className, ...props }: OptionTileProps) {
  return (
    <button
      type="button"
      aria-pressed={selected ?? undefined}
      className={cn(optionTileVariants({ variant, selected }), className)}
      {...props}
    />
  );
}
