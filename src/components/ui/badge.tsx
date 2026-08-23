import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-pill px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        // The resting pill: paper, hairline, ink. Everything else is a status.
        default: "border border-line text-ink",
        accent: "border border-accent/50 bg-accent-soft text-ink",
        // Status pills take the solid token pair rather than a tinted wash —
        // champagne and terracotta are too close in value to read as text on
        // their own tint, and the `-foreground` tokens are contrast-checked.
        success: "bg-success text-success-foreground",
        warning: "bg-warning text-warning-foreground",
        destructive: "bg-destructive text-destructive-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}
