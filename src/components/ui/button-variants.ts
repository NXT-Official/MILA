import { cva } from "class-variance-authority";

/**
 * The button styling recipe, split out of `button.tsx` so that file only
 * exports a component (`react-refresh/only-export-components`) — consumers
 * that need the class recipe without the component (rendering a styled Link
 * or span) import it from here.
 */
export const buttonVariants = cva(
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
      size: {
        sm: "h-9 px-3.5 text-xs",
        md: "h-11 px-5",
        lg: "h-12 px-7 text-base",
        icon: "size-11 p-0",
        pill: "h-11 rounded-full px-5",
        "pill-lg": "h-12 rounded-full px-8 text-xs uppercase tracking-label",
        chip: "h-9 gap-1.5 rounded-full px-3 text-micro uppercase tracking-label-wide",
        row: "h-12 w-full justify-between px-4 text-sm",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);
