import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { memberAuthorization } from "@/lib/auth-session";
import { memberQueryRetry } from "@/lib/queries/member-query";
import { queryKeys } from "@/constants/query-keys";
import type { DailyPalette } from "@/lib/color-analysis/paletteGenerator";
import type { Json } from "@/integrations/supabase/types";

export type SavedPalette = {
  id: string;
  created_at: string;
  palette: DailyPalette;
};

const STRING_FIELDS = [
  "baseColor",
  "statementColor",
  "accentColor",
  "baseHex",
  "statementHex",
  "accentHex",
  "styleVibe",
  "insight",
] as const;

export function isDailyPalette(value: unknown): value is DailyPalette {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    STRING_FIELDS.every((f) => typeof v[f] === "string") &&
    typeof v.isSisterSeasonIncluded === "boolean"
  );
}

export function savedPalettesQueryOptions(userId: string | undefined, client = supabase) {
  return queryOptions({
    queryKey: queryKeys.savedPalettes(userId),
    queryFn: async (): Promise<SavedPalette[]> => {
      if (!userId) return [];
      // Read as her, never as anonymous (an anonymous read sees no palettes).
      const authorization = await memberAuthorization(client.auth, userId);
      const { data, error } = await client
        .from("saved_palettes")
        .select("id,created_at,palette")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .setHeader("Authorization", authorization);
      if (error) throw error;
      return (data ?? [])
        .filter((row) => isDailyPalette(row.palette))
        .map((row) => ({
          id: row.id,
          created_at: row.created_at,
          palette: row.palette as unknown as DailyPalette,
        }));
    },
    retry: memberQueryRetry,
  });
}

export async function savePalette(userId: string, palette: DailyPalette): Promise<void> {
  const { error } = await supabase.from("saved_palettes").insert({
    user_id: userId,
    palette: palette as unknown as Json,
    style_vibe: palette.styleVibe,
  });
  // 23505 = already pinned; the unique index makes saving idempotent.
  if (error && error.code !== "23505") throw error;
}

export async function deleteSavedPalette(userId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from("saved_palettes")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}
