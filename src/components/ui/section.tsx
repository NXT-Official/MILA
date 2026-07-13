import * as React from "react";
import { cn } from "@/lib/utils";

export interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  as?: "section" | "div";
}

export function Section({ as = "section", className, ...props }: SectionProps) {
  const Comp = as;
  return <Comp className={cn("py-14 md:py-20 lg:py-24", className)} {...props} />;
}
