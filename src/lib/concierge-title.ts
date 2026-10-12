/** Mirrors the DB check constraint on concierge_conversations.title:
 * length(trim(title)) > 0 AND length(title) <= 120. */
export const CONVERSATION_TITLE_MAX = 120;

/**
 * A conversation's title, taken from its opening message. Same rule as the
 * mobile app's `conversationTitle` (MILA_MOBILE/src/lib/concierge-history.ts):
 * whitespace collapsed, capped at 120 characters with an ellipsis, and an empty
 * message becomes "New conversation". The column is capped, so an untrimmed
 * title is a failed insert.
 */
export function conversationTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim().replace(/\s+/g, " ");
  if (!trimmed) return "New conversation";
  return truncateWithEllipsis(trimmed, CONVERSATION_TITLE_MAX);
}

/**
 * `text` cut to at most `max` UTF-16 units, ending in an ellipsis when it was
 * cut. The cut backs off to a grapheme boundary, so a surrogate pair or a
 * joined emoji is never split (Postgres rejects a lone surrogate, which would
 * lose the save).
 */
// src: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter
export function truncateWithEllipsis(text: string, max: number): string {
  if (text.length <= max) return text;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let out = "";
  for (const { segment } of segmenter.segment(text)) {
    if (out.length + segment.length > max - 1) break;
    out += segment;
  }
  return `${out}…`;
}
