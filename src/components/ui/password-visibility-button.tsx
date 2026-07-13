import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PasswordVisibilityButtonProps {
  visible: boolean;
  onToggle: () => void;
  className?: string;
}

export function PasswordVisibilityButton({
  visible,
  onToggle,
  className,
}: PasswordVisibilityButtonProps) {
  return (
    <button
      type="button"
      aria-label={visible ? "Hide password" : "Show password"}
      aria-pressed={visible}
      onClick={onToggle}
      className={cn(
        "mila-focus-ring absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-control text-muted transition-colors hover:bg-accent-soft hover:text-ink",
        className,
      )}
    >
      {visible ? (
        <EyeOff aria-hidden="true" className="size-4" strokeWidth={1.75} />
      ) : (
        <Eye aria-hidden="true" className="size-4" strokeWidth={1.75} />
      )}
    </button>
  );
}
