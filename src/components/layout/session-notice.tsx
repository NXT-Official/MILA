import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";

const CHECKING_FEEDBACK_MS = 2500;

/**
 * Mid-session: her token refresh is failing, so reads and saves are on hold
 * (nothing goes out as anonymous). A small note over the page she is on, never
 * a takeover: her page and anything she typed stay put, and her data comes
 * back by itself once the refresh lands.
 */
export function SessionNotice({ onRetry }: { onRetry: () => void }) {
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!checking) return;
    const timer = window.setTimeout(() => setChecking(false), CHECKING_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [checking]);

  return (
    // Phones: above the floating tab bar (bottom 0.75rem + safe area, about
    // 4.5rem tall), so every tab stays tappable. From md up the bar is hidden.
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 md:bottom-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-ink py-1 pl-4 pr-1 text-background shadow-lg">
        <CloudOff className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
        <p role="status" aria-live="polite" className="text-xs">
          Reconnecting. You&apos;re still signed in.
        </p>
        <button
          type="button"
          onClick={() => {
            setChecking(true);
            onRetry();
          }}
          disabled={checking}
          aria-busy={checking}
          className="min-h-11 shrink-0 whitespace-nowrap rounded-full px-4 text-micro uppercase tracking-label-wide underline-offset-4 hover:underline disabled:opacity-70"
        >
          {checking ? "Checking…" : "Try again"}
        </button>
      </div>
    </div>
  );
}
