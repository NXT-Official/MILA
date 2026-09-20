import { cn } from "@/lib/utils";

interface ProductCardProps {
  as?: "div" | "a";
  href?: string;
  image: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function ProductCard({ as = "div", href, image, children, className }: ProductCardProps) {
  const sharedClassName = cn(
    "flex h-full flex-col overflow-hidden rounded-control border border-border bg-canvas shadow-paper",
    className,
  );

  if (as === "a") {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer sponsored"
        className={cn(sharedClassName, "atelier-focus-ring")}
      >
        <div className="aspect-3/4 bg-canvas/60 overflow-hidden relative">{image}</div>
        <div className="flex flex-1 flex-col gap-2 p-3">{children}</div>
      </a>
    );
  }

  return (
    <div className={sharedClassName}>
      <div className="aspect-3/4 bg-canvas/60 overflow-hidden relative">{image}</div>
      <div className="flex flex-1 flex-col gap-2 p-3">{children}</div>
    </div>
  );
}

export function ProductCardCarouselTrack({
  children,
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  "aria-label": string;
}) {
  return (
    <div
      className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable region made keyboard-focusable per WAI-ARIA APG scrolling-region pattern
      tabIndex={0}
      role="group"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}

export function ProductCardCarouselItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 shrink-0 basis-[78%] snap-start sm:basis-[calc(50%-0.375rem)]">
      {children}
    </div>
  );
}
