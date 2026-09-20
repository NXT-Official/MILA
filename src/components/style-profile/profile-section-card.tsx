import { cn } from "@/lib/utils";

export function ProfileSectionCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("bg-card rounded-card border border-border shadow-paper p-6 sm:p-8", className)}
    >
      {children}
    </div>
  );
}
