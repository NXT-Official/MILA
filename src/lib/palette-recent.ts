import { RECENT_TRIOS, pushRecent } from "@/lib/color-analysis/daily-palette";

/**
 * What the daily palette remembers on this device: the day it was last
 * shuffled, how many shuffles that day, and the last five trios shown. Nothing
 * here is secret and nothing is required: a blocked or broken store just means
 * today's palette starts from the first pick again.
 */
export type PaletteState = {
  dateKey: string;
  attempt: number;
  recent: string[];
  /** The trio key on screen today, once it has been recorded in `recent`. */
  shown?: string;
};

export interface PaletteStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const keyFor = (userId: string) => `mila:daily-palette:${userId}`;

function browserStorage(): PaletteStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function fresh(dateKey: string, recent: string[] = []): PaletteState {
  return { dateKey, attempt: 0, recent };
}

/** The saved state for `todayKey`; a new day keeps the recent trios and restarts the attempt count. */
export function readPaletteState(
  userId: string,
  todayKey: string,
  storage: PaletteStorage | null = browserStorage(),
): PaletteState {
  if (!storage) return fresh(todayKey);
  try {
    const raw = storage.getItem(keyFor(userId));
    if (!raw) return fresh(todayKey);
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object") return fresh(todayKey);
    const { dateKey, attempt, recent } = value as Record<string, unknown>;
    if (
      typeof dateKey !== "string" ||
      typeof attempt !== "number" ||
      !Number.isInteger(attempt) ||
      attempt < 0 ||
      !Array.isArray(recent) ||
      !recent.every((k) => typeof k === "string") ||
      ((value as { shown?: unknown }).shown !== undefined &&
        typeof (value as { shown?: unknown }).shown !== "string")
    ) {
      return fresh(todayKey);
    }
    const kept = (recent as string[]).slice(-RECENT_TRIOS);
    if (dateKey !== todayKey) return fresh(todayKey, kept);
    const shown = (value as { shown?: string }).shown;
    return shown === undefined
      ? { dateKey, attempt, recent: kept }
      : { dateKey, attempt, recent: kept, shown };
  } catch {
    return fresh(todayKey);
  }
}

export function writePaletteState(
  userId: string,
  state: PaletteState,
  storage: PaletteStorage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      keyFor(userId),
      JSON.stringify({ ...state, recent: state.recent.slice(-RECENT_TRIOS) }),
    );
  } catch {
    // A full or blocked store only costs her the remembered shuffle.
  }
}

/**
 * Records the trio now on screen as the newest recent one (once), so a reload
 * shows it again and tomorrow's pick cannot repeat it.
 */
export function recordShown(state: PaletteState, key: string): PaletteState {
  if (state.shown === key) return state;
  return { ...state, recent: pushRecent(state.recent, key, RECENT_TRIOS), shown: key };
}

/**
 * The state the card opens on. `startFresh` (a check-in just changed her) keeps
 * `recent`, moves to the next attempt and counts the trio on screen as recent,
 * so she is handed a NEW pick, never the one she had.
 */
export function initialPaletteState(stored: PaletteState, startFresh: boolean): PaletteState {
  if (!startFresh) return stored;
  return {
    dateKey: stored.dateKey,
    attempt: stored.attempt + 1,
    recent: stored.shown ? pushRecent(stored.recent, stored.shown, RECENT_TRIOS) : stored.recent,
  };
}
