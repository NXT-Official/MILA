import * as React from "react";

/** Renders `fallback` when there is no src or the image fails to load. */
export function ImageWithFallback({
  src,
  fallback,
  ...props
}: Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> & {
  src: string | null | undefined;
  fallback: React.ReactNode;
}) {
  const [broken, setBroken] = React.useState(false);
  if (!src || broken) return <>{fallback}</>;
  return <img src={src} onError={() => setBroken(true)} {...props} />;
}
