import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "mila-focus-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium cursor-pointer transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-editorial disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ink text-surface hover:-translate-y-px hover:bg-ink/90 active:translate-y-0",
        secondary:
          "border border-line bg-surface text-ink hover:bg-accent-soft/60 active:bg-accent-soft/80",
        outline: "border border-line bg-canvas text-ink hover:bg-accent-soft/40",
        ghost: "bg-transparent text-ink hover:bg-accent-soft/50",
        editorial:
          "h-auto rounded-none bg-transparent p-0 text-ink underline decoration-line decoration-1 underline-offset-4 hover:decoration-accent",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      },
      size: {
        sm: "h-9 px-3.5 text-xs",
        md: "h-11 px-5",
        lg: "h-12 px-7 text-base",
        icon: "size-11 p-0",
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

export { Button, buttonVariants };
