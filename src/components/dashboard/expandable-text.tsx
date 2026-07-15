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
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollHeight - el.clientHeight > 1);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [text, clampClassName]);

  return (
    <div>
      <p ref={ref} id={id} className={cn(className, !expanded && clampClassName)}>
        {text}
      </p>
      {overflowing ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={id}
          className="mila-focus-ring mt-1 rounded-control text-[11px] font-medium uppercase tracking-[0.18em] text-accent hover:underline"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  );
}
