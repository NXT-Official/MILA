import { CloudCheck, LoaderCircle, RotateCcw, CloudOff } from "lucide-react";
import { cn } from "@/lib/utils";

export type SaveStatus = "idle" | "saving" | "saved" | "dirty" | "error";

const COPY: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Progress saved",
  dirty: "Unsaved changes",
  error: "Unable to save",
};

export function SaveStatusIndicator({
  status,
  onRetry,
  className,
}: {
  status: SaveStatus;
  onRetry?: () => void;
  className?: string;
}) {
  if (status === "idle") return null;

  return (
    <div className={cn("flex items-center gap-2 text-xs", className)} role="status">
      {status === "saving" && (
        <LoaderCircle className="size-3.5 animate-spin text-muted" aria-hidden="true" />
      )}
      {status === "saved" && <CloudCheck className="size-3.5 text-accent" aria-hidden="true" />}
      {status === "dirty" && <CloudOff className="size-3.5 text-muted" aria-hidden="true" />}
      {status === "error" && <CloudOff className="size-3.5 text-destructive" aria-hidden="true" />}
      <span className={cn("tracking-wide", status === "error" ? "text-destructive" : "text-muted")}>
        {COPY[status]}
      </span>
      {status === "error" && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mila-focus-ring inline-flex items-center gap-1 rounded-control text-accent hover:underline"
        >
          <RotateCcw className="size-3" aria-hidden="true" />
          Retry
        </button>
      ) : null}
    </div>
  );
}
