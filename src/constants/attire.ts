/**
 * The attire registers a catalogue piece can read as — the vocabulary shared
 * by the classifier, the inventory review prompt, and the admin console's
 * shop catalogue ("Business Professional" among them).
 *
 * Mirrors the products.attire TEXT[] column (see
 * supabase/migrations/20261005105000_add_attire_to_products.sql). App-level
 * constant, deliberately not a DB enum, so the vocabulary can evolve without
 * a migration.
 */
export const ATTIRE_VALUES = [
  "Business Professional",
  "Business Casual",
  "Smart Casual",
  "Casual",
  "Athletic",
  "Evening",
  "Formal",
] as const;

export type Attire = (typeof ATTIRE_VALUES)[number];

export function isAttire(value: string): value is Attire {
  return (ATTIRE_VALUES as readonly string[]).includes(value);
}
