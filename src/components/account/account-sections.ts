import {
  CreditCard,
  Database,
  MapPin,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export type AccountSection = "membership" | "preferences" | "location" | "privacy" | "security";

export const ACCOUNT_SECTIONS: { id: AccountSection; label: string; icon: LucideIcon }[] = [
  { id: "membership", label: "Membership", icon: CreditCard },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { id: "location", label: "Default Location", icon: MapPin },
  { id: "security", label: "Email & Security", icon: ShieldCheck },
  { id: "privacy", label: "Privacy & Data", icon: Database },
];

const SECTION_IDS: readonly string[] = ACCOUNT_SECTIONS.map((s) => s.id);

/** A section id from the URL, or undefined for anything that is not one (the list shows). */
export function sanitizeAccountSection(value: unknown): AccountSection | undefined {
  return typeof value === "string" && SECTION_IDS.includes(value)
    ? (value as AccountSection)
    : undefined;
}

export type SectionChangePlan =
  | { kind: "navigate"; section: AccountSection | null; replace: boolean; cameFromList: boolean }
  | { kind: "history-back"; cameFromList: false };

/**
 * How to change the open section in the URL. Going from the list into a
 * section on phone or tablet is the one history push; every move after that
 * replaces, so a single Back always returns to the list and "Back to account"
 * and the browser's Back agree. On desktop the list is always beside the
 * content, so everything replaces. `cameFromList` is whether the entry just
 * behind this one is the list, which is what makes a real history Back safe.
 */
export function planSectionChange(
  current: AccountSection | null,
  next: AccountSection | null,
  ctx: { wide: boolean; cameFromList: boolean },
): SectionChangePlan {
  if (next === null) {
    return ctx.cameFromList
      ? { kind: "history-back", cameFromList: false }
      : { kind: "navigate", section: null, replace: true, cameFromList: false };
  }
  const fromList = current === null && !ctx.wide;
  return {
    kind: "navigate",
    section: next,
    replace: !fromList,
    cameFromList: fromList ? true : ctx.wide ? false : ctx.cameFromList,
  };
}

/**
 * Search params for /account: the open section lives in the URL (`?section=security`)
 * so browser and phone Back return to the list and a section can be linked to.
 * Anything unknown is dropped rather than thrown, which falls back to the list.
 */
// src: https://tanstack.com/router/latest/docs/framework/react/guide/search-params#validating-search-params · @tanstack/react-router 1.170.41
export function validateAccountSearch(search: Record<string, unknown>): {
  section?: AccountSection;
} {
  const section = sanitizeAccountSection(search.section);
  return section ? { section } : {};
}
