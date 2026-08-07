import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function ExpandableText({
  text,
  clampClassName,
  className,
}: {
  text: string;
  clampClassName: string;
  className?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    // Observe the element, not the window: mobile browser chrome collapsing fires
    // resize continuously, and only this element's box actually matters.
    const check = () => setOverflowing(el.scrollHeight - el.clientHeight > 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, clampClassName, expanded]);

  return (
    <div>
      <p ref={ref} id={id} className={cn(className, !expanded && clampClassName)}>
        {text}
      </p>
      {overflowing && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={id}
          className="atelier-focus-ring mt-1 rounded-control text-label font-medium uppercase tracking-label text-ink underline decoration-1 underline-offset-4 hover:decoration-2"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}
