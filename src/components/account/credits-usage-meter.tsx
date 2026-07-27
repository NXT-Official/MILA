import { useEffect, useState } from "react";
import { formatResetCountdown } from "@/lib/credits-countdown";

export function CreditsUsageMeter({ remaining, total }: { remaining: number; total: number }) {
  const [countdown, setCountdown] = useState(() => formatResetCountdown(new Date()));

  useEffect(() => {
    const id = setInterval(() => setCountdown(formatResetCountdown(new Date())), 60_000);
    return () => clearInterval(id);
  }, []);

  // Purchased credits push the balance above the plan's daily allowance, so the
  // bar has to grow with it rather than clamp — otherwise a bought pack reads
  // as "0 of 0 left today".
  const clampedRemaining = Math.max(0, remaining);
  const scale = Math.max(total, clampedRemaining);
  const percentUsed = scale > 0 ? Math.round(((scale - clampedRemaining) / scale) * 100) : 0;
  // No daily allowance means nothing is replenished at midnight — whatever is
  // left came from a purchased pack, so drop the "today"/reset framing.
  const daily = total > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="uppercase tracking-[0.2em] text-[10px] text-stone">Styling Credits</span>
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
      {daily && <p className="text-[10px] text-stone">Resets in {countdown}</p>}
    </div>
  );
}
