const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** "Today's OOTD" only for a post made today in her local time; otherwise a short date. */
export function ootdLabel(createdAt: string, now: Date = new Date()): string {
  const posted = new Date(createdAt);
  if (Number.isNaN(posted.getTime())) return "";
  if (dayKey(posted) === dayKey(now)) return "Today's OOTD";
  return posted.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Name the avatar initial is taken from. Her own post shows "You" as the label but her real initial. */
export function avatarNameFor(post: { is_self: boolean; author_name: string | null }): string {
  return post.author_name?.trim() || "Member";
}
