import { cn } from "@/lib/utils";

interface ProductCardProps {
  as?: "div" | "a";
  href?: string;
  image: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Non-interactive decoration over the image (the garment badge). */
  overlay?: React.ReactNode;
  /**
   * Controls pinned top-right over the image (Save). Rendered beside the card,
   * not inside it: when the card is a link, a button inside the <a> would be
   * invalid HTML and would hijack the link's click.
   */
  actions?: React.ReactNode;
}

export function ProductCard({
  as = "div",
  href,
  image,
  children,
  className,
  overlay,
  actions,
}: ProductCardProps) {
  const sharedClassName = cn(
    "flex h-full flex-col overflow-hidden rounded-control border border-border bg-canvas shadow-paper",
    className,
  );

  const content = (
    <>
      <div className="aspect-3/4 bg-canvas/60 overflow-hidden relative">
        {image}
        {overlay}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">{children}</div>
    </>
  );

  const card =
    as === "a" ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer sponsored"
        className={cn(sharedClassName, "atelier-focus-ring")}
      >
        {content}
      </a>
    ) : (
      <div className={sharedClassName}>{content}</div>
    );

  if (!actions) return card;

  // The actions box comes after the card in DOM order, so it paints above the
  // image without a z-index and tabs after the link.
  return (
    <div className="relative h-full">
      {card}
      <div className="absolute right-2 top-2 flex gap-2">{actions}</div>
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
