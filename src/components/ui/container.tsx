import * as React from "react";
import { cn } from "@/lib/utils";

const widthMap = {
  reading: "max-w-reading",
  content: "max-w-content",
  wide: "max-w-wide",
} as const;

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: keyof typeof widthMap;
}

export function Container({ width = "content", className, ...props }: ContainerProps) {
  return (
    <div
      className={cn("mx-auto w-full px-5 sm:px-8 lg:px-10", widthMap[width], className)}
      {...props}
    />
  );
}
