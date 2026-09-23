import type { SupabaseClient } from "@supabase/supabase-js";

export type TrackedEventName =
  "signup_completed" | "onboarding_completed" | "look_generated" | "purchase_started";

// Best-effort: a failed analytics insert must never break the caller's flow
// or surface to the user, same shape as logAiSpend.
export async function trackEvent(
  supabase: SupabaseClient,
  userId: string,
  eventName: TrackedEventName,
  properties?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("analytics_events").insert({
    user_id: userId,
    event_name: eventName,
    source: "web",
    properties: properties ?? null,
  });
  if (error) console.error("[trackEvent] insert failed:", error.message);
}
