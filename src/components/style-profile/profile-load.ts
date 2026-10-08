/**
 * Whether the Style Profile editor may open. Only on her real row: a read that
 * failed (offline, a 5xx, her session reconnecting) or came back empty is not
 * an empty profile. Opening the editor on blank defaults is how one tap used to
 * save those defaults over her colour analysis.
 */
export function profileLoadOutcome(result: { data: unknown; error: unknown }): "loaded" | "failed" {
  return !result.error && result.data ? "loaded" : "failed";
}
