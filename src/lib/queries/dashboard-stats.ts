import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { memberAuthorization } from "@/lib/auth-session";
import { memberQueryRetry } from "@/lib/queries/member-query";
import {
  UNDERTONES,
  SEASONS,
  BODIES,
  FACE_SHAPES,
  HAIR_TYPES,
  GENDERS,
  HAIR_LENGTHS,
  SKIN_DEPTHS,
} from "@/constants/style-profile";
import { isNonEmptyColorProfile, type StyleProfileRow } from "@/lib/style-profile/completion";

const PROFILE_FIELD_CHECKS: ((profile: StyleProfileRow) => boolean)[] = [
  (p) => (UNDERTONES as readonly string[]).includes(p.skin_undertone ?? ""),
  (p) => (SEASONS as readonly string[]).includes(p.color_season ?? ""),
  (p) => (BODIES as readonly string[]).includes(p.body_type ?? ""),
  (p) => (FACE_SHAPES as readonly string[]).includes(p.face_shape ?? ""),
  (p) => (HAIR_TYPES as readonly string[]).includes(p.hair_type ?? ""),
  (p) => (HAIR_LENGTHS as readonly string[]).includes(p.hair_length ?? ""),
  (p) => (GENDERS as readonly string[]).includes(p.gender ?? ""),
  (p) => (SKIN_DEPTHS as readonly string[]).includes(p.skin_depth ?? ""),
  (p) => isNonEmptyColorProfile(p.color_profile),
];

export function styleProfileCompletionPercent(profile: StyleProfileRow | null | undefined): number {
  if (!profile) return 0;
  const passed = PROFILE_FIELD_CHECKS.filter((check) => check(profile)).length;
  return Math.round((passed / PROFILE_FIELD_CHECKS.length) * 100);
}

export interface RecentLook {
  id: string;
  /** Null for an auto-saved look whose visual hadn't rendered yet. */
  image_url: string | null;
  match_score: number | null;
  created_at: string;
}

export interface DashboardLookStats {
  recentLooks: RecentLook[];
  looksThisMonth: number;
  streakDays: number;
}

/**
 * Consecutive local days with a look. A streak that ran through yesterday stays
 * alive until the end of today; it breaks only when yesterday also has no look.
 */
export function computeStreakDays(createdAtDates: string[], now: Date = new Date()): number {
  const keyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const days = new Set(createdAtDates.map((iso) => keyOf(new Date(iso))));

  const cursor = new Date(now);
  if (!days.has(keyOf(cursor))) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (days.has(keyOf(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function dashboardLookStatsQueryOptions(userId: string | undefined, client = supabase) {
  return queryOptions({
    queryKey: ["dashboard-look-stats", userId] as const,
    queryFn: async (): Promise<DashboardLookStats> => {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      // Read as her, never as anonymous (an anonymous read sees no looks).
      const authorization = await memberAuthorization(client.auth, userId as string);

      const [{ data: recent, error: recentError }, { count, error: countError }] =
        await Promise.all([
          client
            .from("outfits")
            .select("id,image_url,match_score,created_at")
            .eq("user_id", userId as string)
            .order("created_at", { ascending: false })
            .limit(30)
            .setHeader("Authorization", authorization),
          client
            .from("outfits")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId as string)
            .gte("created_at", monthStart.toISOString())
            .setHeader("Authorization", authorization),
        ]);

      if (recentError) throw recentError;
      if (countError) throw countError;

      const rows = recent ?? [];
      return {
        recentLooks: rows.slice(0, 6),
        looksThisMonth: count ?? 0,
        streakDays: computeStreakDays(rows.map((r) => r.created_at)),
      };
    },
    enabled: !!userId,
    staleTime: 60_000,
    retry: memberQueryRetry,
  });
}
