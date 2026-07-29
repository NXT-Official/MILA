import { cn } from "@/lib/utils";

export function AvatarInitial({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-full border border-porcelain/60",
        "bg-linear-to-br from-atelier-champagne/30 to-porcelain/20 font-serif text-sm text-ink",
        className,
      )}
    >
      {(name[0] ?? "M").toUpperCase()}
    </span>
  );
}
