import * as React from "react";

import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-pill border border-line px-2.5 py-0.5 text-xs font-semibold text-ink transition-colors",
        className,
      )}
      {...props}
    />
  );
}
