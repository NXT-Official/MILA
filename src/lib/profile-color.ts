export type ColorMetrics = {
  season: string | null;
  undertone: string | null;
  hue: string | null;
  value: string | null;
  chroma: string | null;
  selectedAesthetic: string | null;
};

type ProfileRow =
  | {
      color_profile?: unknown;
      color_season?: string | null;
      skin_undertone?: string | null;
    }
  | null
  | undefined;

export function deriveColorMetrics(row: ProfileRow): ColorMetrics {
  const json = (row?.color_profile ?? null) as Record<string, unknown> | null;
  const axes = (json?.axes ?? {}) as Record<string, unknown>;
  const season = (json?.season as string | undefined) ?? row?.color_season ?? null;
  const undertone =
    (json?.undertone as string | undefined) ??
    (json?.calculatedUndertone as string | undefined) ??
    row?.skin_undertone ??
    null;
  return {
    season: season ?? null,
    undertone: undertone ?? null,
    hue: (axes?.hue as string | undefined) ?? (json?.toneType as string | undefined) ?? null,
    value: (axes?.value as string | undefined) ?? (json?.brightness as string | undefined) ?? null,
    chroma:
      (axes?.chroma as string | undefined) ?? (json?.saturation as string | undefined) ?? null,
    selectedAesthetic: (json?.selectedAesthetic as string | undefined) ?? null,
  };
}
