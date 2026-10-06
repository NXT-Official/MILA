import {
  BODIES,
  type BodyType,
  type DetailedColorProfile as StudioDossier,
} from "@/constants/style-profile";

function isBodyType(value: unknown): value is BodyType {
  return typeof value === "string" && (BODIES as readonly string[]).includes(value);
}

/**
 * The silhouette to show and save. The one the member picked (`profiles.body_type`)
 * always wins; the colour read's guess — made from a face-only selfie — only
 * fills in when she hasn't picked one.
 */
export function memberBodyType(chosen: unknown, readGuess: unknown): BodyType | null {
  if (isBodyType(chosen)) return chosen;
  if (isBodyType(readGuess)) return readGuess;
  return null;
}

/** A fresh colour read, with the silhouette she picked kept in place of the read's guess. */
export function withChosenBodyType(read: StudioDossier, chosen: unknown): StudioDossier {
  return { ...read, bodyType: memberBodyType(chosen, read.bodyType) ?? read.bodyType };
}
