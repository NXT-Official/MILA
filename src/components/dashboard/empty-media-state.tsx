import { ImageOff } from "lucide-react";

export function EmptyMediaState({
  message,
  className = "max-w-2xl",
  action,
}: {
  message: string;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={`atelier-media-frame ${className}`}>
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <ImageOff className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{message}</p>
        {action}
      </div>
    </div>
  );
}
