import * as React from "react";

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
