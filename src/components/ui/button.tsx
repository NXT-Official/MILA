import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "atelier-focus-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium cursor-pointer transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-editorial disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ink text-surface hover:-translate-y-px hover:bg-ink/90 active:translate-y-0",
        secondary:
          "border border-line bg-surface text-ink hover:bg-accent-soft/60 active:bg-accent-soft/80",
        outline: "border border-line bg-canvas text-ink hover:bg-accent-soft/40",
        ghost: "bg-transparent text-ink hover:bg-accent-soft/50",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        glass: "atelier-glass text-ink hover:border-border",
      },
      // shadcn's own scale. Every size keeps the base `text-sm font-medium` —
      // no per-size type sizes, no uppercase, no letterspacing. Label case and
      // tracking belong to the app's *labels* (`text-label uppercase
      // tracking-label`), which is a different thing from a button.
      size: {
        sm: "h-8 gap-1.5 px-3",
        md: "h-9 px-4 py-2",
        lg: "h-10 px-6",
        icon: "size-9 p-0",
        pill: "h-9 rounded-full px-4",
        chip: "h-8 gap-1.5 rounded-full px-3",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button };
