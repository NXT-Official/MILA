import type { DupeMatch } from "@/lib/dupe-hunter.functions";

export type ShopSort = "best_match" | "price_low" | "price_high";

export function sortMatches(matches: DupeMatch[], sort: ShopSort): DupeMatch[] {
  if (sort === "price_low") return [...matches].sort((a, b) => a.price - b.price);
  if (sort === "price_high") return [...matches].sort((a, b) => b.price - a.price);
  return matches;
}
