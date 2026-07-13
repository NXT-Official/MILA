import { Construction } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Inline notice for an unfinished portion of an otherwise working page —
 * e.g. one disabled action inside a functional form or panel. Pair with
 * `aria-describedby` on the control it explains.
 */
export function DevelopmentNotice({
  id,
  title = "In development",
  description,
  className,
}: {
  id?: string;
  title?: string;
  description: string;
  className?: string;
}) {
  return (
    <div
      id={id}
      role="status"
      className={cn("rounded-card border border-line bg-accent-soft/40 px-4 py-3", className)}
    >
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink">
        <Construction aria-hidden="true" className="size-3.5 text-accent" strokeWidth={1.75} />
        {title}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{description}</p>
    </div>
  );
}
