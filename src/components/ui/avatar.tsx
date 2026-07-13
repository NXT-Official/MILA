import * as React from "react";
import { cn } from "@/lib/utils";

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  src?: string | null;
  alt: string;
  fallback: string;
  size?: "sm" | "md" | "lg";
}

const sizeMap = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-base" } as const;

export function Avatar({ src, alt, fallback, size = "md", className, ...props }: AvatarProps) {
  const [errored, setErrored] = React.useState(false);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-pill border border-line bg-accent-soft font-medium text-ink",
        sizeMap[size],
        className,
      )}
      {...props}
    >
      {src && !errored ? (
        <img
          src={src}
          alt={alt}
          className="size-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <span aria-hidden="true">{fallback}</span>
      )}
    </span>
  );
}
