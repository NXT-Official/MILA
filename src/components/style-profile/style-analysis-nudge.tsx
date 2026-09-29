import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  isSnoozed,
  isStyleAnalysisStale,
  snoozeUntil,
  STYLE_ANALYSIS_NUDGE_SNOOZE_KEY,
} from "@/lib/style-analysis-nudge";

/**
 * Periodic "refresh your style analysis" banner — Style Profile page only,
 * shown once STYLE_ANALYSIS_NUDGE_THRESHOLD_DAYS have passed since the
 * user's last completed onboarding (first-time or a
 * RestartStyleAnalysisAction re-run — both log the same
 * `onboarding_completed` analytics event, so one query covers both).
 * Dismissing snoozes it for STYLE_ANALYSIS_NUDGE_SNOOZE_DAYS via
 * localStorage — no server-side dismissal state to manage.
 */
export function StyleAnalysisNudge({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const [lastCompletedAt, setLastCompletedAt] = useState<string | null | undefined>(undefined);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("analytics_events")
      .select("created_at")
      .eq("user_id", userId)
      .eq("event_name", "onboarding_completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (cancelled) return;
        setLastCompletedAt(data?.[0]?.created_at ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (dismissed || lastCompletedAt === undefined) return null;
  if (typeof window !== "undefined" && isSnoozed(new Date(), (k) => window.localStorage.getItem(k)))
    return null;
  if (!isStyleAnalysisStale(lastCompletedAt)) return null;

  return (
    <div className="mb-8 flex items-start justify-between gap-4 rounded-card border border-accent/60 bg-accent-soft p-5">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-ink" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-ink">Time for a style refresh?</p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            It's been a few months since your last style analysis — bodies, seasons, and taste
            drift. Re-running it keeps every recommendation dialed in.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => {
            window.localStorage.setItem(STYLE_ANALYSIS_NUDGE_SNOOZE_KEY, snoozeUntil(new Date()));
            setDismissed(true);
          }}
          className="text-micro uppercase tracking-label text-muted-foreground hover:text-ink transition-colors"
        >
          Not now
        </button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate({ to: "/onboarding/style-profile" })}
        >
          Refresh analysis
        </Button>
      </div>
    </div>
  );
}
