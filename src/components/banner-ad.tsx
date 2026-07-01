import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { logAdEvent } from "@/lib/monetization";
import { useAuth } from "@/hooks/use-auth";

/**
 * Placeholder banner ad slot. Records impressions and clicks against the
 * ad_events backend. Swap the inner markup for a real ad SDK iframe later.
 */
export function BannerAd({
  placement,
  hidden,
  onDismiss,
}: {
  placement: string;
  hidden?: boolean;
  onDismiss?: () => void;
}) {
  const { user } = useAuth();
  const loggedRef = useRef(false);

  useEffect(() => {
    if (hidden || !user || loggedRef.current) return;
    loggedRef.current = true;
    void logAdEvent(user.id, { adType: "banner", event: "impression", placement });
  }, [hidden, user, placement]);

  if (hidden) return null;

  return (
    <div className="relative w-full border border-dashed border-border bg-muted/40 px-4 py-3 flex items-center justify-between text-xs text-muted-foreground">
      <span className="uppercase tracking-[0.22em] text-[10px]">Sponsored</span>
      <button
        type="button"
        onClick={() => {
          if (user)
            void logAdEvent(user.id, { adType: "banner", event: "click", placement });
        }}
        className="font-medium text-foreground hover:underline"
      >
        Your ad here — banner placeholder
      </button>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss ad"
          onClick={() => {
            if (user)
              void logAdEvent(user.id, {
                adType: "banner",
                event: "dismissed",
                placement,
              });
            onDismiss();
          }}
          className="ml-3 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}