import * as React from "react";

export function ImageWithFallback({
  src,
  alt,
  fallback,
  ...props
}: Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "onError" | "alt"> & {
  src: string | null | undefined;
  alt: string;
  fallback: React.ReactNode;
}) {
  const [broken, setBroken] = React.useState(false);
  if (!src || broken) return <>{fallback}</>;
  return <img src={src} alt={alt} onError={() => setBroken(true)} {...props} />;
}
