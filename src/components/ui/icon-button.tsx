import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const iconButtonVariants = cva(
  "mila-focus-ring inline-flex shrink-0 items-center justify-center rounded-control transition-colors duration-200 ease-editorial disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ink text-surface hover:bg-ink/90",
        ghost: "bg-transparent text-ink hover:bg-accent-soft/50",
        outline: "border border-line bg-canvas text-ink hover:bg-accent-soft/40",
      },
      size: {
        sm: "size-9 [&_svg]:size-4",
        md: "size-11 [&_svg]:size-4",
        lg: "size-12 [&_svg]:size-5",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof iconButtonVariants> {
  label: string;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, label, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(iconButtonVariants({ variant, size, className }))}
      {...props}
    >
      {children}
    </button>
  ),
);
IconButton.displayName = "IconButton";
