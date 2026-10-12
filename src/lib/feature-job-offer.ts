/**
 * What her latest Lens, Dupe hunt, Concierge or item-detection job means right
 * now (P2b plan, W0). A reload or a tab switch comes back to "still working",
 * then to the result, a refund or a calm failure, instead of losing a paid
 * answer.
 *
 * Pure and dependency-free (no imports, no zod): mobile copies this file
 * verbatim (same path). Every decision reads `now` from the caller at the
 * moment of deciding; nothing here holds a clock.
 */

export const FEATURE_JOB_KINDS = [
  "lens_analysis",
  "dupe_search",
  "concierge",
  "item_detection",
] as const;
export type FeatureJobKind = (typeof FEATURE_JOB_KINDS)[number];

/** The reaper fails a running job this long after its deadline. */
export const REAP_GRACE_MS = 30_000;
/** Allowed gap between the device clock and the server clock. */
export const CLOCK_SKEW_MS = 15_000;
/** A finished job is offered back for this long (or until the local day ends). */
export const OFFER_WINDOW_MS = 12 * 60 * 60 * 1000;
/** The server delivered the result and kept the charge but could not store it. */
export const PERSIST_FAILED_DELIVERED = "persist_failed_delivered";
/** Failed-and-refunded rows that mean "nothing found", not "something broke". */
export const EMPTY_RESULT_CODES: readonly string[] = ["no_close_match", "no_items_found"];

export type FeatureJobOffer = "running" | "stale" | "ready" | "empty" | "failed";

/** A job row as the server names its fields. */
export type FeatureJobLike = {
  id: string;
  kind: string;
  client_request_id: string;
  status: string;
  credit_state: string;
  result: unknown;
  error_code: string | null;
  deadline_at: string;
  created_at: string;
  completed_at: string | null;
};

export type FeatureJobOfferContext = {
  /** Now, in ms since the epoch, read by the caller when it decides. */
  now: number;
  /** Jobs she dismissed: never offered again. */
  dismissed?: readonly string[];
  /** Whether two instants fall on the same local day. Defaults to the device's calendar. */
  sameLocalDay?: (a: number, b: number) => boolean;
};

/** A Postgres timestamp in ms; fractions beyond milliseconds are cut so every engine agrees. */
function timeOf(value: string | null | undefined): number {
  if (typeof value !== "string" || value.length === 0) return Number.NaN;
  return Date.parse(value.replace(/(\.\d{3})\d+/, "$1"));
}

function defaultSameLocalDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function finishedAt(job: FeatureJobLike): number {
  return timeOf(job.completed_at ?? job.created_at);
}

export function featureJobOffer(
  job: FeatureJobLike | null | undefined,
  ctx: FeatureJobOfferContext,
): FeatureJobOffer | null {
  if (!job) return null;

  if (job.status === "running") {
    const deadline = timeOf(job.deadline_at);
    if (!Number.isFinite(deadline)) return null;
    return ctx.now <= deadline + REAP_GRACE_MS + CLOCK_SKEW_MS ? "running" : "stale";
  }

  if (job.status !== "succeeded" && job.status !== "failed") return null;
  if (ctx.dismissed?.includes(job.id)) return null;

  const finished = finishedAt(job);
  if (!Number.isFinite(finished)) return null;
  const sameDay = (ctx.sameLocalDay ?? defaultSameLocalDay)(finished, ctx.now);
  if (!sameDay && ctx.now - finished > OFFER_WINDOW_MS) return null;

  if (job.status === "succeeded") return "ready";
  if (job.error_code === PERSIST_FAILED_DELIVERED) return null;
  if (job.error_code && EMPTY_RESULT_CODES.includes(job.error_code)) return "empty";
  return "failed";
}

const LABEL_TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
// ICU puts a narrow no-break space (U+202F) or a no-break space (U+00A0) before AM/PM.
const ODD_SPACES = new RegExp(`[${String.fromCharCode(0x202f, 0x00a0)}]`, "g");

/**
 * A small label for a result that comes back from before today, so last
 * night's read is not taken for this morning's: "From last night, 11:58 PM" or
 * "From yesterday, 5:05 PM". Null for a result from today.
 */
export function featureOfferLabel(job: FeatureJobLike, now: number): string | null {
  const finished = finishedAt(job);
  if (!Number.isFinite(finished) || defaultSameLocalDay(finished, now)) return null;
  const time = LABEL_TIME.format(new Date(finished)).replace(ODD_SPACES, " ");
  const yesterday = defaultSameLocalDay(finished, now - 86_400_000);
  if (yesterday && new Date(finished).getHours() >= 18) return `From last night, ${time}`;
  if (yesterday) return `From yesterday, ${time}`;
  return `From ${new Date(finished).toLocaleDateString("en-US", { weekday: "long" })}, ${time}`;
}

const FAILURE_LEAD: Record<FeatureJobKind, string> = {
  lens_analysis: "Mila couldn't finish reading your photo.",
  dupe_search: "Mila couldn't finish your dupe hunt.",
  concierge: "Mila couldn't answer that.",
  item_detection: "Mila couldn't tag this look.",
};

/** The calm failure line: "Your credit is back." only when it truly is. */
export function featureFailureCopy(kind: FeatureJobKind, refunded: boolean): string {
  return `${FAILURE_LEAD[kind]} ${refunded ? "Your credit is back." : "Please try again."}`;
}
