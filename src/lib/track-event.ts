import type { SupabaseClient } from "@supabase/supabase-js";
import { capturePhEvent, identifyPhUser } from "@/lib/posthog-client";

export type TrackedEventName =
  "signup_completed" | "onboarding_completed" | "look_generated" | "purchase_started";

// Best-effort: a failed analytics write must never break the caller's flow
// or surface to the user, same shape as logAiSpend. Events land in two
// places: the `analytics_events` table (in-app + admin reporting) and
// PostHog (product analytics).
export async function trackEvent(
  supabase: SupabaseClient,
  userId: string,
  eventName: TrackedEventName,
  properties?: Record<string, unknown>,
): Promise<void> {
  // PostHog mirror first — it must not wait on the database round-trip.
  // identify() re-asserts the distinct id because signup events fire before
  // the auth listener's own identify has necessarily run.
  identifyPhUser(userId);
  capturePhEvent(eventName, { ...(properties ?? {}), source: "web" });

  const { error } = await supabase.from("analytics_events").insert({
    user_id: userId,
    event_name: eventName,
    source: "web",
    properties: properties ?? null,
  });
  if (error) console.error("[trackEvent] insert failed:", error.message);
}
