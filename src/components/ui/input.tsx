import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface InputProps extends React.ComponentProps<"input"> {
  leadingIcon?: LucideIcon;
  trailingIcon?: LucideIcon;
  trailingElement?: React.ReactNode;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type,
      leadingIcon: LeadingIcon,
      trailingIcon: TrailingIcon,
      trailingElement,
      ...props
    },
    ref,
  ) => {
    const hasTrailing = Boolean(TrailingIcon || trailingElement);

    if (!LeadingIcon && !hasTrailing) {
      return (
        <input
          type={type}
          className={cn(
            "mila-focus-ring flex h-11 w-full rounded-control border border-line bg-surface px-3.5 py-1 text-base text-ink transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            className,
          )}
          ref={ref}
          {...props}
        />
      );
    }

    return (
      <div className="relative">
        {LeadingIcon ? (
          <LeadingIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
            strokeWidth={1.75}
          />
        ) : null}
        <input
          type={type}
          className={cn(
            "mila-focus-ring flex h-11 w-full rounded-control border border-line bg-surface px-3.5 py-1 text-base text-ink transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            LeadingIcon && "pl-10",
            hasTrailing && "pr-10",
            className,
          )}
          ref={ref}
          {...props}
        />
        {TrailingIcon ? (
          <TrailingIcon
            aria-hidden="true"
            className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
            strokeWidth={1.75}
          />
        ) : null}
        {trailingElement ? (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">{trailingElement}</div>
        ) : null}
      </div>
    );
  },
);
Input.displayName = "Input";

export { Input };
