import { useEffect, useState } from "react";
import { formatResetCountdown } from "@/lib/credits-countdown";

export function CreditsUsageMeter({ remaining, total }: { remaining: number; total: number }) {
  const [countdown, setCountdown] = useState(() => formatResetCountdown(new Date()));

  useEffect(() => {
    const id = setInterval(() => setCountdown(formatResetCountdown(new Date())), 60_000);
    return () => clearInterval(id);
  }, []);

  const clampedRemaining = Math.max(0, remaining);
  const scale = Math.max(total, clampedRemaining);
  const percentUsed = scale > 0 ? Math.round(((scale - clampedRemaining) / scale) * 100) : 0;
  const daily = total > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="uppercase tracking-label text-micro text-stone">Styling Credits</span>
        <span className="font-semibold text-ink tabular-nums">
          {daily ? `${clampedRemaining} of ${scale} left today` : `${clampedRemaining} left`}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-porcelain/60">
        <div
          className="h-full rounded-full bg-ink transition-all"
          style={{ width: `${100 - percentUsed}%` }}
        />
      </div>
      {daily && <p className="text-micro text-stone">Resets in {countdown}</p>}
    </div>
  );
}
