import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClimateWidget } from "@/components/dashboard/climate-widget";
import type { ClimateState } from "@/constants/climate";
import { useAuth } from "@/hooks/use-auth";
import {
  generateDailyLook,
  type DailyLook,
  type GenerateLookInputData,
  type GeneratedLook,
} from "@/lib/generate-outfit.functions";
import { isMemberSessionUnavailable } from "@/lib/auth-session";
import {
  JOB_CHECK_TIMEOUT_MS,
  answerAsked,
  changedPressPlan,
  confirmLookAsked,
  createLookMark,
  createPressCheck,
  decideLookRecovery,
  deviceIsOffline,
  findCachedJob,
  generationClock,
  generationFetch,
  generationFailureNotice,
  generationJobKeys,
  generationJobPhase,
  generationMutationKey,
  generationMutationOptions,
  generationRequestKey,
  generationRequests,
  generationWaitCopy,
  isJobInProgress,
  isSessionRefusal,
  isUnknownGenerationOutcome,
  jobIsForLook,
  lastLookPressCheck,
  learnServerClock,
  lookAnswersPress,
  lookEventFor,
  lostAnswerNotice,
  ownGenerationJobsQueryOptions,
  ownJobBehindLatest,
  ownPressesHold,
  ownRowsExpectedUntil,
  pendingGenerationFilters,
  readLatestJobWithin,
  readOwnJobsWithin,
  refusalRetires,
  settleLookForSave,
  styleSheetNeverDrawn,
  trackedLookJobs,
  visualToRecover,
  type ClientGenerationKind,
  type GenerationJobState,
  type GenerationVariables,
  type MemberGenerationJob,
  type OwnJobsState,
} from "@/lib/queries/generation-jobs";
import {
  useGenerationImage,
  useLatestGenerationJob,
  useLongerThan,
  useLookSaved,
  useNow,
  usePendingGenerations,
  useReapStaleJobs,
  useStaleGenerationReaper,
} from "@/hooks/use-generation-jobs";
import { useLiveValue } from "@/hooks/use-live-value";
import { saveOutfitToHistory } from "@/lib/save-outfit.functions";
import { HeroGeneratorForm, type Vibe } from "@/components/dashboard/hero-generator-form";
import { HeroResultPanel } from "@/components/dashboard/hero-result-panel";
import { createLatestRun } from "@/components/dashboard/style-sheet-run";
import { generatePhotoPreview } from "@/lib/photo-preview.functions";
import { generateStyleSheetPreview } from "@/lib/style-sheet.functions";
import { SelfiePhotoWidget } from "@/components/dashboard/selfie-photo-widget";
import { GettingStartedCard } from "@/components/dashboard/getting-started-card";
import { toast } from "sonner";
import { UpgradeSlotsDialog } from "@/components/dashboard/upgrade-slots-dialog";
import { isInsufficientCreditsError } from "@/lib/credits";
import { profileQueryOptions } from "@/lib/queries/profile";
import { isStyleProfileComplete, toStyleProfileRow } from "@/lib/style-profile/completion";
import { useConcierge } from "@/hooks/use-concierge";
import { useCurrentLook } from "@/hooks/use-current-look";
import { DailyPaletteGenerator } from "@/components/wardrobe/DailyPaletteGenerator";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { errorMessage, isStaleBundleError, TimeoutError, withTimeout } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/track-event";
import { notifyIfBackgrounded, requestNotificationPermission } from "@/lib/background-notify";
import {
  Coins,
  Sparkles,
  Flame,
  Images,
  MessageCircle,
  History as HistoryIcon,
} from "lucide-react";
import { creditsQueryOptions } from "@/lib/queries/credits";
import {
  dashboardLookStatsQueryOptions,
  styleProfileCompletionPercent,
} from "@/lib/queries/dashboard-stats";
import { StatTile } from "@/components/dashboard/stat-tile";
import { RecentLooksStrip } from "@/components/dashboard/recent-looks-strip";

function reloadForNewVersion() {
  toast.error("Mila just updated — reloading to grab the latest version. Try again after reload.");
  window.location.reload();
}

// A stuck generation call has no legitimate reason to run past this — the
// server side's own retry budget tops out well under these ceilings (see
// FUNCTION_BUDGET_MS in style-sheet.ts, 280s). Generation itself now runs
// TWO sequential deepseek calls (inventory review, then outfit plan), each
// bounded at 110s server-side (ai.server.ts TIMEOUT_MS), so this must clear
// 220s worst case plus inventory/DB overhead. Set generously above that so a
// real in-progress generation is never cut off before the server's own
// graceful deadline can return its own "unavailable" message — only a
// genuinely hung request should ever hit this client-side timeout.
const LOOK_TIMEOUT_MS = 240_000;
const VISUAL_TIMEOUT_MS = 290_000;

const TIMEOUT_MESSAGE = "This is taking longer than expected. Please refresh and try again.";

// Said when a changed Create press meets an earlier look of hers that this
// page never heard back from (I1): that paid look comes first. (A check that
// fails no longer refuses the press, round 3 ruling: it goes ahead under her
// unanswered id, so it has nothing to say.)
const LAST_LOOK_STILL_COMPOSING =
  "Mila is still finishing your last look. It will show here when it's ready.";
const LAST_LOOK_READY = "Your last look is ready.";
// A save of a look whose vibe and weather could not be confirmed is refused,
// never stored with a guess (round 5, N-3).
const SAVE_UNCONFIRMED = "We couldn't confirm this look yet. Try saving again in a moment.";
// A press refused because her session is reconnecting: nothing ran (round 5, m-3).
const SESSION_REFUSED = "You're reconnecting. Nothing was charged. Press again in a moment.";
// Create waits while her last look is checked (after a reload, or before a
// changed press): said on the button's reason line, never silently (NEW-M1).
const CHECKING_LAST_LOOK = "Checking your last look…";
// An offline press is refused, not held: nothing is sent later on its own (NEW-M1).
const OFFLINE_PRESS = "You're offline. Nothing was sent. Press again once you're back online.";

// Module-level, not per-mount: the look lives in the app shell and a render
// keeps running after the member leaves this tab, so a fresh Dashboard mount
// must still be able to retire a sheet an earlier mount started.
const styleSheetRun = createLatestRun();
// Same reasoning for the portrait preview, tracked apart from the sheet so a
// new sheet never retires a portrait that is still rendering.
const photoPreviewRun = createLatestRun();

// When she last pressed Create in this page. A look finished before that is
// one she chose to replace, so it is never put back on screen unasked (her
// own unanswered request still is). Module-level for the same reason as the
// runs above; a reload starts it again at 0.
let lookClearedAt = 0;

// Look jobs this page has shown as "composing". One of them that succeeds is
// always put on screen when nothing else is there, whatever she pressed in
// the meantime (I1): she watched it being made.
const watchedLookJobs = new Set<string>();

// A look answered under a borrowed id is shown at once with a guess of what
// it was asked for, confirmed from its job row (round 4, R3-1). A save made
// while that is in flight waits for it instead of reading again.
const askedConfirmations = new Map<string, ReturnType<typeof confirmLookAsked>>();
// Whether such a confirmation is running, for Save to wait and say so (round 5).
const lookConfirmCheck = createPressCheck();
// One save at a time: a second tap while one runs does nothing (round 5, N-4).
const lookSaveCheck = createPressCheck();
// Which look is on screen, set in the same call that puts it there, so a
// press that awaited its check sees a look that landed a moment ago (N-2).
const lookOnScreenMark = createLookMark();

// One Create press is checked against her earlier unanswered request at a
// time (the check reads her job row before anything is sent). The check is
// `lastLookPressCheck`: outside React like the marks above, and subscribed to
// below, so Create shows it while it runs (NEW-M1).

/**
 * A look on screen, with the generation job it came from (absent before jobs
 * are live), and what it is saved under: the vibe and weather it was asked
 * for, not whatever the form says now. `fromLabel` marks a look from before
 * today ("From last night, 11:40 PM").
 */
type ShownLook = GeneratedLook & {
  jobId?: string;
  vibe?: string | null;
  weatherLabel?: string | null;
  fromLabel?: string | null;
  /** The request id it was answered under (round 4). */
  requestId?: string;
  /** False while its vibe and weather are a guess still being confirmed (round 4, R3-1). */
  askedConfirmed?: boolean;
};

type LookPayload = Omit<GenerateLookInputData, "clientRequestId">;
type LookVariables = GenerationVariables & { payload: LookPayload };
type StyleSheetOutfit = {
  outfit: DailyLook["outfit"];
  hair: DailyLook["hair"];
  makeup: DailyLook["makeup"];
  vibe_alignment_score: DailyLook["vibe_alignment_score"];
  shoppable_picks: DailyLook["shoppable_picks"];
  forecastRetrievedAt: DailyLook["forecastRetrievedAt"];
};
type StyleSheetVariables = GenerationVariables & { outfit: StyleSheetOutfit; run: number };
type PhotoPreviewOutfit = Pick<DailyLook, "outfit" | "hair" | "makeup" | "vibe_alignment_score">;
type PhotoPreviewVariables = GenerationVariables & { outfit: PhotoPreviewOutfit; run: number };

function jobOf(state: GenerationJobState | undefined): MemberGenerationJob | null {
  return state?.status === "ready" ? state.job : null;
}

function jobsOf(state: OwnJobsState | undefined): MemberGenerationJob[] {
  return state?.status === "ready" ? state.jobs : [];
}

/**
 * A row in progress (by the server's clock, or confirmed alive by the
 * reaper), unless this page already has its answer (the cached row is out of
 * date).
 */
function inProgress(
  job: MemberGenerationJob | null,
  serverNow: number,
  isAlive: (jobId: string) => boolean,
): boolean {
  return (
    isJobInProgress(job, serverNow, isAlive) &&
    !generationRequests.answered((job as MemberGenerationJob).clientRequestId)
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function greetingSuffix(fullName: string | null | undefined) {
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? `, ${first}` : "";
}

const containerVariants = (reduce: boolean, stagger: number): Variants => ({
  hidden: { opacity: 1 },
  visible: { opacity: 1, transition: { staggerChildren: reduce ? 0 : stagger } },
});
const itemVariants = (reduce: boolean, offset: number, duration: number): Variants => ({
  hidden: { opacity: 0, y: reduce ? 0 : offset },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: reduce ? 0.2 : duration, ease: "easeOut" as const },
  },
});

export const Route = createFileRoute("/_authenticated/_app/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const reduce = useReducedMotion() ?? false;
  const cardContainerVariants = containerVariants(reduce, 0.08);
  const cardItemVariants = itemVariants(reduce, 12, 0.35);
  const resultContainerVariants = containerVariants(reduce, 0.1);
  const resultItemVariants = itemVariants(reduce, 16, 0.4);

  const { data: profile, isLoading: profileLoading } = useQuery({
    ...profileQueryOptions(user?.id),
    enabled: !!user?.id,
  });

  const profileComplete = isStyleProfileComplete(toStyleProfileRow(profile));
  const profileCompletionPercent = styleProfileCompletionPercent(toStyleProfileRow(profile));

  const {
    data: credits,
    isLoading: creditsLoading,
    isError: creditsError,
  } = useQuery(creditsQueryOptions(user?.id));
  const {
    data: lookStats,
    isLoading: lookStatsLoading,
    isError: lookStatsError,
  } = useQuery(dashboardLookStatsQueryOptions(user?.id));

  const { openConcierge } = useConcierge();
  const {
    look,
    setLook,
    styleSheetImageDataUri,
    setStyleSheetImageDataUri,
    savedLook,
    setSavedLook,
    // The app-shell flags (kept there so a tab switch can't reset them). This
    // route derives its busy state from the generation mutations and her job
    // rows (below), which also survive a reload, and mirrors it into these so
    // anything else reading the shell sees the same thing.
    setGenerating,
    setStyleSheetLoading,
    setPhotoPreviewLoading,
  } = useCurrentLook();
  const [savingLook, setSavingLook] = useState(false);
  const lookSaved = !!savedLook;
  /** true while the automatic save is writing — the manual button yields to
   * it so one generation can never produce two history rows. */
  const autoSaveInFlightRef = useRef(false);
  const [vibe, setVibe] = useState<Vibe>("Everyday Casual");
  const [agenda, setAgenda] = useState("");
  const [dressCode, setDressCode] = useState("");
  const [indoorOutdoor, setIndoorOutdoor] = useState<"Indoor" | "Outdoor" | "Mixed" | "">("");
  const [creditPaywallOpen, setCreditPaywallOpen] = useState(false);
  const [climate, setClimate] = useState<ClimateState | null>(null);

  const generate = useServerFn(generateDailyLook);
  const saveOutfit = useServerFn(saveOutfitToHistory);
  const generatePhotoPreviewFn = useServerFn(generatePhotoPreview);
  const generateStyleSheetFn = useServerFn(generateStyleSheetPreview);

  // R7: every generation is a TanStack Query mutation under its own key, so a
  // call keeps running when she leaves this page and is found again when she
  // comes back. Her credits and job rows are refreshed by the hook-level
  // onSettled, which runs even after this page has unmounted.
  const lookMutation = useMutation(
    generationMutationOptions<LookVariables, Awaited<ReturnType<typeof generate>>>(
      "look",
      ({ payload, clientRequestId }) =>
        // An answer that is not Mila's (a gateway page) is a lost answer (round 5, m-3).
        withTimeout(
          generate({ data: { ...payload, clientRequestId }, fetch: generationFetch }),
          LOOK_TIMEOUT_MS,
        ),
      queryClient,
    ),
  );
  const styleSheetMutation = useMutation(
    generationMutationOptions<
      StyleSheetVariables,
      Awaited<ReturnType<typeof generateStyleSheetFn>>
    >(
      "style_sheet",
      ({ outfit, clientRequestId }) =>
        withTimeout(
          generateStyleSheetFn({ data: { outfit, clientRequestId }, fetch: generationFetch }),
          VISUAL_TIMEOUT_MS,
        ),
      queryClient,
    ),
  );
  const photoPreviewMutation = useMutation(
    generationMutationOptions<
      PhotoPreviewVariables,
      Awaited<ReturnType<typeof generatePhotoPreviewFn>>
    >(
      "photo_preview",
      ({ outfit, clientRequestId }) =>
        withTimeout(
          generatePhotoPreviewFn({ data: { outfit, clientRequestId }, fetch: generationFetch }),
          VISUAL_TIMEOUT_MS,
        ),
      queryClient,
    ),
  );

  // Calls in flight, from any mount of this page (the mutation cache outlives
  // the route).
  const lookCalls = usePendingGenerations<LookVariables>("look");
  const sheetCalls = usePendingGenerations<StyleSheetVariables>("style_sheet");
  const portraitCalls = usePendingGenerations<PhotoPreviewVariables>("photo_preview");
  // The cache is read directly too: a press is pending there at once, while
  // the subscription above catches up a tick later (no empty-state flash).
  const lookInFlight =
    lookCalls.length > 0 ||
    queryClient.isMutating({ mutationKey: generationMutationKey("look") }) > 0;
  // Only the current run counts: a sheet or portrait drawn for a look that has
  // since been replaced must not keep the new look's spinner going.
  const currentSheetCalls = sheetCalls.filter(
    (call) => !!call.variables && styleSheetRun.isCurrent(call.variables.run),
  );
  const currentPortraitCalls = portraitCalls.filter(
    (call) => !!call.variables && photoPreviewRun.isCurrent(call.variables.run),
  );
  const sheetInFlight = currentSheetCalls.length > 0;
  const portraitInFlight = portraitCalls.some(
    (call) => !!call.variables && photoPreviewRun.isCurrent(call.variables.run),
  );

  // Her latest job row per kind: what survives a reload or a discarded tab.
  // Times are compared on the server's clock (M3); a job past its deadline is
  // dead unless the server's own reaper says it is still alive (M4).
  const userId = user?.id;
  const reaper = useStaleGenerationReaper(userId);
  const serverClockNow = () => generationClock.now();
  const lookJobQuery = useLatestGenerationJob(userId, "look", {
    inFlight: lookInFlight,
    serverNow: serverClockNow,
    isAlive: reaper.isAlive,
  });
  // Everything that follows a job row waits until the table answers. Until the
  // generation_jobs migration is applied it answers "unavailable" (remembered
  // for 5 minutes, M1), the other kinds are never asked, and the page keeps
  // exactly its pre-jobs behaviour.
  const jobsLive = lookJobQuery.data?.status === "ready";
  const sheetJobQuery = useLatestGenerationJob(userId, "style_sheet", {
    inFlight: sheetInFlight,
    enabled: jobsLive,
    serverNow: serverClockNow,
    isAlive: reaper.isAlive,
  });
  const portraitJobQuery = useLatestGenerationJob(userId, "photo_preview", {
    inFlight: portraitInFlight,
    enabled: jobsLive,
    serverNow: serverClockNow,
    isAlive: reaper.isAlive,
  });
  // Her newest look row. The row the page follows for recovery is `lookJob`
  // below: her own job when another device's newer job is this one (round 3).
  const latestLookJob = jobsLive ? jobOf(lookJobQuery.data) : null;
  const sheetJob = jobsLive ? jobOf(sheetJobQuery.data) : null;
  const portraitJob = jobsLive ? jobOf(portraitJobQuery.data) : null;
  const sheetRowKnown = jobsLive && sheetJobQuery.data?.status === "ready";

  // Whether a row is one of her own unanswered requests from this tab.
  const ownRequest = (kind: ClientGenerationKind, job: MemberGenerationJob | null) =>
    !!job && !!userId && !!generationRequests.owns(userId, kind, job.clientRequestId);

  // Her own unanswered presses, read by id (round 3): her own job lands even
  // when another device's newer job is the latest row. Read only while one of
  // them is not the latest row, each read bounded by JOB_CHECK_TIMEOUT_MS, and
  // not while her own call is in flight (its answer and the latest row's
  // 10 s poll cover it). A missing row is looked for again on its own while
  // it can still appear (round 4): a return to the tab alone can be merged
  // into a read that was answered before her row existed.
  const pendingLookEntries = userId ? generationRequests.pending(userId, "look") : [];
  const pendingLookIds = pendingLookEntries.map((entry) => entry.id);
  const ownLookReadNeeded =
    jobsLive && pendingLookIds.some((id) => id !== latestLookJob?.clientRequestId);
  const ownLookJobsQuery = useQuery(
    ownGenerationJobsQueryOptions(userId, "look", pendingLookIds, {
      enabled: ownLookReadNeeded && !lookInFlight,
      serverNow: serverClockNow,
      isAlive: reaper.isAlive,
      rowExpectedUntil: ownRowsExpectedUntil(pendingLookEntries),
    }),
  );
  const herLookJob = ownLookReadNeeded
    ? ownJobBehindLatest(
        jobsOf(ownLookJobsQuery.data).filter((job) => ownRequest("look", job)),
        latestLookJob,
      )
    : null;

  // After a reload, Create waits for her look row's first answer, so a press
  // can never be sent before her own unanswered job is recognised (I1). The
  // wait is bounded (NEW-M1): a read that hangs releases Create after the
  // check's time limit, and a changed press then goes through its own check.
  // Only when she has a look press unanswered (round 4): otherwise there is
  // nothing of hers to recognise, and Create is ready at once.
  const firstLookRead =
    !!userId &&
    pendingLookIds.length > 0 &&
    lookJobQuery.data === undefined &&
    lookJobQuery.isFetching &&
    lookJobQuery.failureCount === 0;
  const firstLookReadOverdue = useLongerThan(firstLookRead, JOB_CHECK_TIMEOUT_MS);
  // The check before a changed press, from any mount of the page (NEW-M1).
  const pressChecking = useSyncExternalStore(
    lastLookPressCheck.subscribe,
    lastLookPressCheck.isChecking,
    () => false,
  );
  const checkingLastLook = (firstLookRead && !firstLookReadOverdue) || pressChecking;
  // A confirmation of what the look on screen was asked for is running (round 5).
  const lookConfirming = useSyncExternalStore(
    lookConfirmCheck.subscribe,
    lookConfirmCheck.isChecking,
    () => false,
  );
  // Her session is reconnecting: the member fetch guard refuses anonymous
  // reads and React Query keeps the last good rows on screen while it retries.
  const reconnecting = [lookJobQuery, sheetJobQuery, portraitJobQuery].some((query) =>
    isMemberSessionUnavailable(query.failureReason),
  );
  const anyWaiting =
    lookInFlight ||
    sheetCalls.length > 0 ||
    portraitCalls.length > 0 ||
    [latestLookJob, herLookJob, sheetJob, portraitJob].some((job) => job?.status === "running");
  const now = useNow(anyWaiting);
  const serverNow = generationClock.now(now);
  useReapStaleJobs(reaper, userId, [latestLookJob, herLookJob, sheetJob, portraitJob], serverNow);

  // A finished picture for the look on screen, read back from the private
  // bucket (signed URL, succeeded rows only), matched to the look by its
  // headline and description.
  const sheetToShow = visualToRecover(sheetJob, look, !!styleSheetImageDataUri);
  const portraitToShow = visualToRecover(portraitJob, look, !!look?.imageDataUri);
  const sheetImage = useGenerationImage(userId, sheetToShow, !!sheetToShow && !sheetInFlight);
  const portraitImage = useGenerationImage(
    userId,
    portraitToShow,
    !!portraitToShow && !portraitInFlight,
  );

  // A running row is shown as running HERE when it is her own request from
  // this tab, or (a look) nothing is on screen yet, or (a picture) it is
  // being drawn for the look on screen. A job started on another device or
  // tab never covers the look she is looking at; pressing again meanwhile is
  // answered by the server's calm "still finishing your last request".
  // (`ownRequest` and her own rows, `herLookJob`, are read above.)
  // The look row the page follows: her own finished job behind another
  // device's newer one, unless the newest row is hers too.
  const lookJob =
    herLookJob && herLookJob.status !== "running" && !ownRequest("look", latestLookJob)
      ? herLookJob
      : latestLookJob;
  const lookRunning =
    inProgress(latestLookJob, serverNow, reaper.isAlive) &&
    (!look || ownRequest("look", latestLookJob))
      ? latestLookJob
      : inProgress(herLookJob, serverNow, reaper.isAlive)
        ? herLookJob
        : null;
  const sheetRunning =
    inProgress(sheetJob, serverNow, reaper.isAlive) &&
    (jobIsForLook(sheetJob, look) || ownRequest("style_sheet", sheetJob))
      ? sheetJob
      : null;
  const portraitRunning =
    inProgress(portraitJob, serverNow, reaper.isAlive) &&
    (jobIsForLook(portraitJob, look) || ownRequest("photo_preview", portraitJob))
      ? portraitJob
      : null;

  const generating = lookInFlight || !!lookRunning;
  const styleSheetLoading =
    sheetInFlight || !!sheetRunning || (!!sheetToShow && sheetImage.isFetching);
  const photoPreviewLoading =
    portraitInFlight || !!portraitRunning || (!!portraitToShow && portraitImage.isFetching);

  useEffect(() => {
    setGenerating(generating);
    setStyleSheetLoading(styleSheetLoading);
    setPhotoPreviewLoading(photoPreviewLoading);
  }, [
    generating,
    styleSheetLoading,
    photoPreviewLoading,
    setGenerating,
    setStyleSheetLoading,
    setPhotoPreviewLoading,
  ]);

  /** Staged wait copy, timed from the press (or the job row after a reload). */
  function waitFor(
    kind: ClientGenerationKind,
    calls: Array<{ submittedAt: number }>,
    running: MemberGenerationJob | null,
  ) {
    // Presses are device times, rows are server times: compare each on its own clock.
    const elapsed = [
      ...calls.map((call) => now - call.submittedAt),
      ...(running ? [serverNow - Date.parse(running.createdAt)] : []),
    ].filter((ms) => Number.isFinite(ms));
    if (elapsed.length === 0) return null;
    return generationWaitCopy(kind, Math.max(...elapsed), { canLeave: jobsLive, reconnecting });
  }
  const lookWait = generating ? waitFor("look", lookCalls, lookRunning) : null;
  const styleSheetWait = styleSheetLoading
    ? waitFor("style_sheet", currentSheetCalls, sheetRunning)
    : null;
  const photoPreviewWait = photoPreviewLoading
    ? waitFor("photo_preview", currentPortraitCalls, portraitRunning)
    : null;
  const styleSheetNotDrawn =
    sheetRowKnown &&
    !!look &&
    !styleSheetLoading &&
    !styleSheetImageDataUri &&
    styleSheetNeverDrawn(sheetJob, look);

  // The look to bring back, if any: her own unanswered press, a job this page
  // showed as composing, or her recent look when nothing is on screen (see
  // lookToRecover). It waits for the check that she has not saved it already.
  // Judged by the server's clock read now, at render (NEW-I1): a tab left open
  // is judged by the time she comes back (her return re-renders the page),
  // never by the time it was opened.
  const shownLook = look as ShownLook | null;
  // Another look waits for hers only while her unanswered ids are first being
  // read, or one of their jobs is still being made or can still land
  // (round 4): once read and none is, the hold lifts.
  const ownPressesStillLive =
    ownLookReadNeeded &&
    ownPressesHold({
      state: ownLookJobsQuery.data,
      requestIds: pendingLookIds,
      // Held while her ids could not be read, or a row has not appeared,
      // until 5 minutes after her newest press (round 5, N-1).
      rowExpectedUntil: ownRowsExpectedUntil(pendingLookEntries),
      now: serverNow,
      isAlive: reaper.isAlive,
    });
  const lookDecision =
    jobsLive && !!userId && !profileLoading && !lookInFlight && lookJob?.status === "succeeded"
      ? decideLookRecovery({
          job: lookJob,
          shown: shownLook ? { jobId: shownLook.jobId ?? null } : null,
          own: ownRequest("look", lookJob),
          watched: watchedLookJobs.has(lookJob.id),
          ownPending: ownPressesStillLive,
          lastPressAt: lookClearedAt,
          clock: generationClock,
        })
      : null;
  const savedCheck = useLookSaved(
    userId,
    lookDecision && lookJob
      ? { jobId: lookDecision.jobId, look: lookDecision.look, since: lookJob.createdAt }
      : null,
  );

  /** Whether this kind already has a call in flight for its current run (a same-tick double press). */
  const callInFlight = (
    kind: ClientGenerationKind,
    run: ReturnType<typeof createLatestRun>,
  ): boolean =>
    queryClient
      .getMutationCache()
      .findAll(pendingGenerationFilters(kind))
      .some((mutation) => run.isCurrent((mutation.state.variables as { run?: number })?.run ?? -1));

  /**
   * The call ended without an answer (a timeout, a dropped connection). When
   * her own job row exists, it speaks for the call, whatever it says: still
   * running (the spinner stays), done (the result lands by itself), or failed
   * (its own notice says so, M5). Only without a row is a generic error shown.
   */
  const rowSpeaksFor = async (
    kind: ClientGenerationKind,
    clientRequestId: string,
    error: unknown,
  ): Promise<boolean> => {
    if (!jobsLive || !user || !isUnknownGenerationOutcome(error) || isStaleBundleError(error)) {
      return false;
    }
    // A look is read by her own id (round 4): the page follows her own look
    // rows, so her row behind another device's newer one speaks too. A sheet
    // or portrait is followed by its latest row only, so that row must be hers.
    if (kind === "look") {
      const own = await readOwnJobsWithin(user.id, kind, [clientRequestId]);
      return (
        own.status === "read" &&
        jobsOf(own.state).some((job) => job.clientRequestId === clientRequestId)
      );
    }
    // Read within a time limit, never held for the network (NEW-M1); the page
    // follows what it found.
    const read = await readLatestJobWithin(user.id, kind);
    if (read.status !== "read") return false;
    queryClient.setQueryData(generationJobKeys.latest(user.id, kind), read.state);
    const job = jobOf(read.state);
    return !!job && job.clientRequestId === clientRequestId;
  };

  /** Shared by the auto-generation in generateLook() and the manual retry button. */
  async function generateStyleSheetVisual(
    outfitForSheet: StyleSheetOutfit,
  ): Promise<string | null> {
    if (!user) return null;
    const run = styleSheetRun.start();
    const sheetKey = generationRequestKey(outfitForSheet);
    const clientRequestId = generationRequests.begin(user.id, "style_sheet", sheetKey);
    const sheetEntry = generationRequests.owns(user.id, "style_sheet", clientRequestId);
    try {
      requestNotificationPermission();
      const res = await styleSheetMutation.mutateAsync({
        outfit: outfitForSheet,
        clientRequestId,
        run,
        userId: user.id,
      });
      generationRequests.settle(user.id, "style_sheet", clientRequestId);
      // A sheet drawn for a look that has since been replaced must not land
      // on the new look, stop its spinner, or be saved against its text.
      if (!styleSheetRun.isCurrent(run)) return null;
      if (res.mode === "style_sheet") {
        setStyleSheetImageDataUri(res.imageDataUri);
        setSavedLook(null);
        // The user may have tabbed away during the render — a toast alone
        // (shown by the callers below) would go unseen. This covers the
        // background case; the foregrounded case keeps its existing toast.
        notifyIfBackgrounded("Your look is ready", "Mila finished rendering your style sheet.");
        return res.imageDataUri;
      }
      toast.error(res.reason);
      return null;
    } catch (e) {
      // A lost answer keeps the id, so her retry attaches to the same job
      // instead of paying twice; a real answer from the server retires it,
      // unless an earlier send of it may have run (round 5, m-3).
      const lost = isUnknownGenerationOutcome(e);
      if (!lost && refusalRetires(sheetEntry, sheetKey)) {
        generationRequests.settle(user.id, "style_sheet", clientRequestId);
      }
      if (!styleSheetRun.isCurrent(run)) return null;
      if (await rowSpeaksFor("style_sheet", clientRequestId, e)) return null;
      if (e instanceof TimeoutError) {
        toast.error(TIMEOUT_MESSAGE);
      } else if (isStaleBundleError(e)) {
        reloadForNewVersion();
      } else if (isInsufficientCreditsError(e)) {
        setCreditPaywallOpen(true);
      } else if (lost) {
        toast.error(lostAnswerNotice("style_sheet"));
      } else if (isSessionRefusal(e)) {
        toast.error(SESSION_REFUSED);
      } else {
        toast.error(errorMessage(e, "Couldn't create your style sheet. Please try again."));
      }
      // The busy flag follows the style-sheet mutation, and the mutation
      // refreshes her credits when it settles (queries/generation-jobs.ts).
      return null;
    }
  }

  async function generateLook() {
    if (generating || styleSheetLoading || photoPreviewLoading || checkingLastLook) return;
    // The call is pending in the mutation cache the moment it is pressed, so a
    // second press in the same tick is refused here, before anything is sent.
    if (queryClient.isMutating({ mutationKey: generationMutationKey("look") }) > 0) return;
    if (lastLookPressCheck.isChecking()) return;
    if (!user || !profile?.body_type || !profile?.color_season) {
      toast.error("Complete your Style Profile first.");
      return;
    }
    if (!climate) {
      toast.error("Still finding today’s weather. Choose a city in the weather panel to continue.");
      return;
    }
    // Offline: refused now, before anything is cleared, and never sent later
    // on its own; she presses again when she is back (NEW-M1).
    if (deviceIsOffline()) {
      toast.error(OFFLINE_PRESS);
      return;
    }
    const payload: LookPayload = {
      bodyType: profile.body_type,
      colorSeason: profile.color_season,
      skinUndertone: profile.skin_undertone ?? null,
      faceShape: profile.face_shape ?? null,
      hairType: profile.hair_type ?? null,
      weather: `${climate.label} (in ${climate.location})`,
      tempF: climate.tempF,
      tempC: climate.tempC,
      condition: climate.condition,
      location: climate.location,
      vibe,
      agenda: agenda.trim() || undefined,
      dressCode: dressCode.trim() || undefined,
      indoorOutdoor: indoorOutdoor || undefined,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    const requestKey = generationRequestKey(payload);
    // A changed request while an earlier one of hers is unanswered: her job
    // row is read first, so a paid look is never replaced unseen (I1). Also
    // when her row's first read has not answered yet; never when the table is
    // known to be missing (the server ignores the ids then).
    const pendingIds = generationRequests.pending(user.id, "look").map((entry) => entry.id);
    // An earlier press of this same request that is still unanswered: with no
    // answer from the check, this press goes under it (round 4, I-A).
    const sameRequest =
      generationRequests.pending(user.id, "look").find((entry) => entry.key === requestKey) ?? null;
    // The look on screen before the check, to tell whether one lands during it.
    const shownBefore = lookOnScreenMark.jobId();
    const earlier =
      lookJobQuery.data?.status === "unavailable"
        ? []
        : generationRequests.pending(user.id, "look").filter((entry) => entry.key !== requestKey);
    // Her unanswered id, when the check got no answer (NEW-M1, round 3 ruling).
    let sendAs: string | null = null;
    // An earlier press of hers answers this one: it is shown, nothing is sent.
    let answeredBy: "attach" | "recover" | null = null;
    if (earlier.length > 0) {
      // Shown on Create while it runs, bounded by JOB_CHECK_TIMEOUT_MS (NEW-M1).
      // Her unanswered presses' rows are read by id (round 3), so her own job
      // counts even when another device's newer job is the latest row.
      if (!lastLookPressCheck.start()) return;
      const read = await readOwnJobsWithin(user.id, "look", pendingIds).finally(() =>
        lastLookPressCheck.finish(),
      );
      if (read.status === "read") {
        queryClient.setQueryData(generationJobKeys.own(user.id, "look", pendingIds), read.state);
      }
      // Her own look landed while the check ran, or the look on screen is one
      // of her unanswered jobs: it answers this press. It is shown as it is,
      // with its style sheet, and nothing is cleared or sent (round 4, I-B).
      const herJobIds =
        read.status === "read"
          ? jobsOf(read.state)
              .filter((job) => pendingIds.includes(job.clientRequestId))
              .map((job) => job.id)
          : [];
      if (
        lookAnswersPress({
          shownBefore,
          shownNow: lookOnScreenMark.jobId(),
          herJobIds,
        })
      ) {
        toast(LAST_LOOK_READY);
        return;
      }
      const plan = changedPressPlan(
        read,
        earlier,
        generationClock.now(),
        reaper.isAlive,
        sameRequest?.id,
      );
      if (plan.action === "attach" || plan.action === "recover") answeredBy = plan.action;
      // No answer (in time, or at all): the press goes ahead under this
      // request's own unanswered id, else her latest one, so the server
      // attaches to or replays that job and never charges twice.
      if (plan.action === "send_as") sendAs = plan.id;
    }
    // A press clears the screen for the look it brings, sent or not (round 3:
    // recovery never swaps a look on screen, so her own look lands on a clear
    // screen). Whatever sheet or portrait is still in flight belongs to the
    // look being replaced.
    styleSheetRun.invalidate();
    photoPreviewRun.invalidate();
    // Put back if the server refuses this press: a refused press replaced nothing.
    const clearedBefore = lookClearedAt;
    lookClearedAt = Date.now();
    lookOnScreenMark.set(null);
    setLook(null);
    setSavedLook(null);
    setStyleSheetImageDataUri(null);
    if (answeredBy === "attach") {
      toast(LAST_LOOK_STILL_COMPOSING);
      return;
    }
    if (answeredBy === "recover") {
      toast(LAST_LOOK_READY);
      return;
    }
    // One id per press; the same request pressed again before it is answered
    // reuses it, so the server charges once. Each id keeps what its first
    // press asked for (round 3).
    const clientRequestId =
      (sendAs ? generationRequests.reuse(user.id, "look", sendAs) : null) ??
      generationRequests.begin(user.id, "look", requestKey, {
        vibe: payload.vibe,
        weather: payload.weather,
      });
    const pressEntry = generationRequests.owns(user.id, "look", clientRequestId);
    // Sent under an earlier, different request's id (not this request's own).
    const borrowedId = sendAs && pressEntry?.key !== requestKey ? sendAs : null;
    let outfit: Awaited<ReturnType<typeof generate>>;
    try {
      outfit = await lookMutation.mutateAsync({ payload, clientRequestId, userId: user.id });
      generationRequests.settle(user.id, "look", clientRequestId);
    } catch (e) {
      // The server refunds the credit on any thrown error, and the mutation's
      // onSettled refreshes her credits (and her job row) either way, so the
      // header never keeps the pre-refund count. A lost answer keeps the id:
      // her retry then attaches to the same job instead of paying twice.
      const lost = isUnknownGenerationOutcome(e);
      if (!lost) {
        // Only this request's own id, on its only send, is retired: a
        // borrowed one (round 4, M-1), or one sent before (round 5, m-3),
        // says nothing about a job an earlier send may have started.
        if (refusalRetires(pressEntry, requestKey)) {
          generationRequests.settle(user.id, "look", clientRequestId);
        }
        // A real answer that it did not run: her last look may come back as
        // it would have before this press.
        lookClearedAt = clearedBefore;
      }
      if (await rowSpeaksFor("look", clientRequestId, e)) return;
      if (e instanceof TimeoutError) {
        toast.error(TIMEOUT_MESSAGE);
      } else if (isStaleBundleError(e)) {
        reloadForNewVersion();
      } else if (isInsufficientCreditsError(e)) {
        setCreditPaywallOpen(true);
      } else if (lost) {
        // Never the raw error (a gateway page, "Failed to fetch"): round 5, m-3.
        toast.error(lostAnswerNotice("look"));
      } else if (isSessionRefusal(e)) {
        toast.error(SESSION_REFUSED);
      } else {
        toast.error(errorMessage(e, "Couldn’t compose a look. Please try again."));
      }
      return;
    }
    // What this look was asked for, settled from the answer the moment it
    // arrives (round 3, then round 4 R3-1): the answer's own job (`jobId`)
    // when the page holds its row (a replay, or another running job's look);
    // this press's own when it went under its own request's id; under a
    // borrowed id, what that id's first press asked for, confirmed from the
    // job's row, which says which press made it. A save waits for that.
    const pressAsked = {
      vibe: payload.vibe,
      weatherLabel: `${climate.label} (${climate.location})`,
    };
    const cachedJob = outfit.jobId
      ? findCachedJob(
          queryClient
            .getQueriesData({ queryKey: generationJobKeys.all(user.id) })
            .map(([, data]) => data),
          outfit.jobId,
        )
      : null;
    const { asked, confirmed } = answerAsked({
      cachedJob,
      // Only an id borrowed from another request can carry another input (N-5).
      sentAs: borrowedId,
      entry: pressEntry,
      pressAsked,
      replayed: outfit.replayed,
    });
    const shown: ShownLook = {
      ...outfit,
      imageDataUri: null,
      vibe: asked.vibe,
      weatherLabel: asked.weatherLabel,
      requestId: clientRequestId,
      askedConfirmed: confirmed,
    };
    lookOnScreenMark.set(shown);
    setLook(shown);
    // Counted once per job, never for a stored job (a replay or an attach),
    // with the job's own vibe (round 5, m-4).
    const lookEvent = lookEventFor({
      jobId: outfit.jobId,
      replayed: outfit.replayed,
      vibe: asked.vibe,
      tracked: trackedLookJobs,
    });
    if (lookEvent) trackEvent(supabase, user.id, "look_generated", lookEvent);
    if (!confirmed) {
      void confirmLook(shown).then((result) => {
        // Still unconfirmed: the guess stays for display, and Save confirms
        // again or refuses (round 5, N-3).
        if (!result.confirmed) return;
        setLook((prev) => {
          if (!prev || (prev as ShownLook).requestId !== clientRequestId) return prev;
          const corrected: ShownLook = {
            ...(prev as ShownLook),
            ...result.asked,
            askedConfirmed: true,
          };
          return corrected;
        });
      });
    }

    // No stock-model fallback anymore — a visual requires a consented photo,
    // since the style sheet is now the only auto-generated image. A look
    // without one is still composed, shown, and saved below.
    let sheetUri: string | null = null;
    if (profile.photo_consent_at) {
      const {
        outfit: outfitBody,
        hair,
        makeup,
        vibe_alignment_score,
        shoppable_picks,
        forecastRetrievedAt,
      } = outfit;
      sheetUri = await generateStyleSheetVisual({
        outfit: outfitBody,
        hair,
        makeup,
        vibe_alignment_score,
        shoppable_picks,
        forecastRetrievedAt,
      });
    }

    // Every generation lands in the member's history automatically — with
    // the sheet just drawn when there is one, text and picks only otherwise.
    // The manual save button is only ever the retry path now.
    await autoSaveLook(shown, sheetUri);
  }

  async function previewOnMyPhoto() {
    if (!look || photoPreviewLoading || generating || !user) return;
    if (callInFlight("photo_preview", photoPreviewRun)) return;
    const run = photoPreviewRun.start();
    const { outfit, hair, makeup, vibe_alignment_score } = look;
    const portraitOutfit: PhotoPreviewOutfit = { outfit, hair, makeup, vibe_alignment_score };
    const portraitKey = generationRequestKey(portraitOutfit);
    const clientRequestId = generationRequests.begin(user.id, "photo_preview", portraitKey);
    const portraitEntry = generationRequests.owns(user.id, "photo_preview", clientRequestId);
    try {
      requestNotificationPermission();
      const res = await photoPreviewMutation.mutateAsync({
        outfit: portraitOutfit,
        clientRequestId,
        run,
        userId: user.id,
      });
      generationRequests.settle(user.id, "photo_preview", clientRequestId);
      // A portrait drawn for a look that has since been replaced must not land
      // on the new look or be saved against its text.
      if (!photoPreviewRun.isCurrent(run)) return;
      if (res.mode === "photo_edit") {
        setLook((prev) => (prev ? { ...prev, imageDataUri: res.imageDataUri } : prev));
        setSavedLook(null);
        toast.success("Portrait preview ready.");
        notifyIfBackgrounded(
          "Your portrait preview is ready",
          "Mila finished rendering your photo preview.",
        );
      } else {
        toast.error(res.reason);
      }
    } catch (e) {
      // A lost answer keeps the id; a real answer from the server retires it,
      // unless an earlier send of it may have run (round 5, m-3).
      const lost = isUnknownGenerationOutcome(e);
      if (!lost && refusalRetires(portraitEntry, portraitKey)) {
        generationRequests.settle(user.id, "photo_preview", clientRequestId);
      }
      if (!photoPreviewRun.isCurrent(run)) return;
      if (await rowSpeaksFor("photo_preview", clientRequestId, e)) return;
      if (e instanceof TimeoutError) {
        toast.error(TIMEOUT_MESSAGE);
      } else if (isStaleBundleError(e)) {
        reloadForNewVersion();
      } else if (isInsufficientCreditsError(e)) {
        setCreditPaywallOpen(true);
      } else if (lost) {
        toast.error(lostAnswerNotice("photo_preview"));
      } else if (isSessionRefusal(e)) {
        toast.error(SESSION_REFUSED);
      } else {
        toast.error(errorMessage(e, "Couldn't create a photo preview. Please try again."));
      }
    }
  }

  async function previewStyleSheet() {
    if (!look || styleSheetLoading || generating) return;
    if (callInFlight("style_sheet", styleSheetRun)) return;
    const { outfit, hair, makeup, vibe_alignment_score, shoppable_picks, forecastRetrievedAt } =
      look;
    const sheetUri = await generateStyleSheetVisual({
      outfit,
      hair,
      makeup,
      vibe_alignment_score,
      shoppable_picks,
      forecastRetrievedAt,
    });
    if (sheetUri) toast.success("Style sheet ready.");
  }

  // --- Coming back: re-attach to what her job rows say -----------------------

  // Learn the server's clock from her own rows (a row lands a moment after
  // the press that started it), only when that press's send time is known
  // exactly: an id sent once (NEW-M2).
  useEffect(() => {
    if (!userId) return;
    for (const job of [latestLookJob, herLookJob, sheetJob, portraitJob]) {
      if (!job) continue;
      const own = generationRequests.owns(userId, job.kind, job.clientRequestId);
      learnServerClock(generationClock, job, own);
    }
  }, [userId, latestLookJob, herLookJob, sheetJob, portraitJob]);

  // A look shown here as composing is remembered: when it succeeds it lands.
  const watchedId = lookRunning?.id;
  useEffect(() => {
    if (watchedId) watchedLookJobs.add(watchedId);
  }, [watchedId]);

  // A finished picture for the look on screen lands once it has been read back.
  useEffect(() => {
    if (!sheetToShow || !sheetImage.data) return;
    setStyleSheetImageDataUri(sheetImage.data);
    setSavedLook(null);
  }, [sheetToShow, sheetImage.data, setStyleSheetImageDataUri, setSavedLook]);

  useEffect(() => {
    if (!portraitToShow || !portraitImage.data) return;
    const image = portraitImage.data;
    setLook((prev) =>
      prev && jobIsForLook(portraitToShow, prev) ? { ...prev, imageDataUri: image } : prev,
    );
    setSavedLook(null);
  }, [portraitToShow, portraitImage.data, setLook, setSavedLook]);

  // Her own sheet or portrait request is answered once its row has settled:
  // the next press gets a fresh id (a reused id would only replay this one).
  // A real failure of it, after its call lost its answer, says so once (M5).
  const sheetCallPending = sheetCalls.length > 0;
  const portraitCallPending = portraitCalls.length > 0;
  useEffect(() => {
    if (!userId) return;
    for (const job of [sheetJob, portraitJob]) {
      if (!job || job.status === "running") continue;
      // While a call of this kind is still in flight, its own answer speaks.
      if (job.kind === "style_sheet" ? sheetCallPending : portraitCallPending) continue;
      if (!generationRequests.owns(userId, job.kind, job.clientRequestId)) continue;
      generationRequests.settle(userId, job.kind, job.clientRequestId);
      const notice = generationFailureNotice(job);
      if (notice) toast.error(notice);
    }
  }, [userId, sheetJob, portraitJob, sheetCallPending, portraitCallPending]);

  // The look: after a route change, a tab switch, a reload or a discarded tab,
  // put back the look she paid for, unless she already saved it. Her own
  // unanswered Create press always lands and then continues to its style
  // sheet, as the press would have.
  const continueWithStyleSheet = useLiveValue(generateStyleSheetVisual);
  // The mark follows any look set from outside this page too (it is set
  // synchronously wherever this page sets one). Declared before the land
  // effect, so in one flush it never overwrites a look that just landed.
  useEffect(() => {
    lookOnScreenMark.set(look as ShownLook | null);
  }, [look]);
  const photoConsentAt = profile?.photo_consent_at;
  useEffect(() => {
    if (!jobsLive || !userId || profileLoading || lookInFlight || !lookJob) return;
    const own = generationRequests.owns(userId, "look", lookJob.clientRequestId);
    if (own) {
      const phase = generationJobPhase(lookJob, generationClock.now());
      if (phase === "failed" || phase === "delivered") {
        generationRequests.settle(userId, "look", own.id);
        // Delivered-but-unsaved was charged and handed over: never a failure,
        // never a refund (N7). A real failure says whether her credit is back.
        const notice = generationFailureNotice(lookJob);
        if (notice) toast.error(notice);
        return;
      }
    }
    if (!lookDecision) return;
    // Wait for the saved check; a check that could not run never drops a paid look.
    if (savedCheck.data === undefined && !savedCheck.isError) return;
    if (lookDecision.own) generationRequests.settle(userId, "look", lookJob.clientRequestId);
    if (savedCheck.data === true) return;
    const recovered: ShownLook = {
      ...lookDecision.look,
      imageDataUri: null,
      jobId: lookDecision.jobId,
      vibe: lookDecision.vibe,
      weatherLabel: lookDecision.weatherLabel,
      fromLabel: lookDecision.fromLabel,
    };
    lookOnScreenMark.set(recovered);
    setLook(recovered);
    setSavedLook(null);
    setStyleSheetImageDataUri(null);
    if (lookDecision.own && photoConsentAt && !jobIsForLook(sheetJob, lookDecision.look)) {
      const { outfit, hair, makeup, vibe_alignment_score, shoppable_picks, forecastRetrievedAt } =
        lookDecision.look;
      void continueWithStyleSheet.current?.({
        outfit,
        hair,
        makeup,
        vibe_alignment_score,
        shoppable_picks,
        forecastRetrievedAt,
      });
    }
  }, [
    jobsLive,
    userId,
    profileLoading,
    lookInFlight,
    lookJob,
    lookDecision,
    savedCheck.data,
    savedCheck.isError,
    photoConsentAt,
    sheetJob,
    setLook,
    setSavedLook,
    setStyleSheetImageDataUri,
    continueWithStyleSheet,
  ]);

  /**
   * Confirms what a look answered under a borrowed id was asked for, from its
   * job row (round 4, R3-1): one confirmation per look at a time, shared by
   * the arrival and by Save, and shown on Save while it runs (round 5).
   */
  function confirmLook(onScreen: ShownLook): ReturnType<typeof confirmLookAsked> {
    const requestId = onScreen.requestId;
    const fallback = { vibe: onScreen.vibe ?? null, weatherLabel: onScreen.weatherLabel ?? null };
    if (!user || !requestId) return Promise.resolve({ asked: fallback, confirmed: false });
    const running = askedConfirmations.get(requestId);
    if (running) return running;
    const confirmation = confirmLookAsked(user.id, {
      requestId,
      jobId: onScreen.jobId ?? null,
      entry: generationRequests.owns(user.id, "look", requestId),
      fallback,
    });
    askedConfirmations.set(requestId, confirmation);
    lookConfirmCheck.start();
    void confirmation.finally(() => {
      askedConfirmations.delete(requestId);
      if (askedConfirmations.size === 0) lookConfirmCheck.finish();
    });
    return confirmation;
  }

  async function saveLookToHistory() {
    if (!user || !look) return;
    // One generation, one row: yield while the automatic save is in flight.
    if (autoSaveInFlightRef.current) return;
    // One save at a time, and Save shows it at once: a second tap while one
    // runs does nothing (round 5, N-4).
    if (!lookSaveCheck.start()) return;
    setSavingLook(true);
    try {
      // A look whose vibe and weather are still a guess (answered under a
      // borrowed id) is confirmed from its job row first, retrying a
      // confirmation that failed; if it still cannot be, the save is refused.
      // A guess is never saved (round 5, N-3).
      const onScreen = look as ShownLook;
      const shownLook = await settleLookForSave(onScreen, () => confirmLook(onScreen));
      if (!shownLook) {
        toast.error(SAVE_UNCONFIRMED);
        return;
      }
      if (shownLook !== onScreen) {
        setLook((prev) =>
          prev && (prev as ShownLook).requestId === shownLook.requestId ? shownLook : prev,
        );
      }
      // Saved under the look's own vibe and weather (the ones it was composed
      // for), never whatever the form or the weather panel say now (M2).
      const weather =
        shownLook?.weatherLabel ?? (climate ? `${climate.label} (${climate.location})` : null);
      if (!weather) return;
      // The style sheet — when drawn — is the richer artifact, so it's what
      // gets saved; without one the look is still saved, text and picks only.
      const imageToSave = styleSheetImageDataUri ?? look.imageDataUri;
      const row = await saveOutfit({
        data: {
          imageDataUri: imageToSave ?? null,
          weather,
          vibe: shownLook?.vibe ?? vibe,
          outfit: look.outfit,
          hair: look.hair,
          makeup: look.makeup,
          vibe_alignment_score: look.vibe_alignment_score,
          forecastRetrievedAt: look.forecastRetrievedAt ?? null,
          productIds: (look.shoppable_picks ?? []).map((item) => item.id),
          // The items themselves (titles, prices, links) — saved so History
          // can show the suggested pieces under the saved look. Sanitized
          // server-side before the row is written.
          shoppable_picks: look.shoppable_picks,
          previewMode: imageToSave
            ? styleSheetImageDataUri
              ? "style_sheet"
              : "photo_edit"
            : undefined,
        },
      });
      setSavedLook({ id: row.id, imageUrl: row.image_url });
      toast.success("Saved to your history.");
    } catch (e) {
      if (isStaleBundleError(e)) {
        reloadForNewVersion();
      } else {
        toast.error(errorMessage(e, "We couldn’t save that look. Please try again."));
      }
    } finally {
      lookSaveCheck.finish();
      setSavingLook(false);
    }
  }

  // Save waits while what this look was asked for is being confirmed (N-3).
  const saveConfirming = lookConfirming && (look as ShownLook | null)?.askedConfirmed === false;

  /**
   * The automatic save: every composed look lands in the member's history as
   * soon as its visual attempt settles — with the style sheet when one was
   * drawn, text and picks only otherwise (a look without photo consent never
   * gets a visual; its row's image_url stays null). `saveLookToHistory`
   * remains as the retry path for a failed automatic save.
   *
   * It saves under the look's own vibe and weather (the ones it was composed
   * for). A look answered under a borrowed id whose vibe can't be confirmed
   * is not auto-saved: a guess is never saved, and Save confirms first (N-3).
   */
  async function autoSaveLook(outfit: ShownLook, imageDataUri: string | null) {
    if (!user) return;
    autoSaveInFlightRef.current = true;
    try {
      const settled = await settleLookForSave(outfit, () => confirmLook(outfit));
      if (!settled) return;
      const weather =
        settled.weatherLabel ?? (climate ? `${climate.label} (${climate.location})` : null);
      if (!weather) return;
      const row = await saveOutfit({
        data: {
          imageDataUri,
          weather,
          vibe: settled.vibe ?? vibe,
          outfit: outfit.outfit,
          hair: outfit.hair,
          makeup: outfit.makeup,
          vibe_alignment_score: outfit.vibe_alignment_score,
          forecastRetrievedAt: outfit.forecastRetrievedAt ?? null,
          productIds: (outfit.shoppable_picks ?? []).map((item) => item.id),
          shoppable_picks: outfit.shoppable_picks,
          previewMode: imageDataUri ? "style_sheet" : undefined,
        },
      });
      setSavedLook({ id: row.id, imageUrl: row.image_url });
    } catch (e) {
      if (isStaleBundleError(e)) {
        reloadForNewVersion();
      } else {
        toast.error(
          errorMessage(
            e,
            "We couldn’t save your look to history automatically. Save it with Save to history.",
          ),
        );
      }
    } finally {
      autoSaveInFlightRef.current = false;
    }
  }

  const blockedReason = profileLoading
    ? "Loading your Style Profile…"
    : !profileComplete
      ? "Complete your Style Profile first."
      : !climate
        ? "Still finding today’s weather. Choose a city in the weather panel to continue."
        : checkingLastLook
          ? CHECKING_LAST_LOOK
          : null;

  function handleAskConcierge() {
    if (!savedLook || !look) return;
    openConcierge({
      lookId: savedLook.id,
      imageUrl: savedLook.imageUrl,
      title: look.outfit.headline,
      source: "Today's look",
    });
  }

  return (
    <motion.div
      className="atelier-page"
      variants={cardContainerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* The instruction a new member never got: what to do first. Hides itself
          once all three moves are done, or when dismissed. */}
      {!profileLoading && !lookStatsLoading ? (
        <motion.section variants={cardItemVariants} className="mb-6">
          <GettingStartedCard
            profileCompletionPercent={profileCompletionPercent}
            hasPhotoConsent={!!profile?.photo_consent_at}
            hasComposedLook={
              (lookStats?.recentLooks?.length ?? 0) > 0 || (lookStats?.looksThisMonth ?? 0) > 0
            }
          />
        </motion.section>
      ) : null}

      <motion.section
        variants={cardItemVariants}
        className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        <StatTile
          label="AI Credits"
          value={String(credits ?? 0)}
          icon={Coins}
          loading={creditsLoading}
          error={creditsError}
        />
        <StatTile
          label="Style Profile"
          value={`${profileCompletionPercent}%`}
          icon={Sparkles}
          loading={profileLoading}
        />
        <StatTile
          label="Looks this month"
          value={String(lookStats?.looksThisMonth ?? 0)}
          icon={Images}
          loading={lookStatsLoading}
          error={lookStatsError}
        />
        <StatTile
          label="Day streak"
          value={String(lookStats?.streakDays ?? 0)}
          icon={Flame}
          loading={lookStatsLoading}
          error={lookStatsError}
        />
      </motion.section>

      <Card asChild className="relative mb-10 sm:mb-14 overflow-hidden atelier-hero-card">
        <motion.section variants={cardItemVariants}>
          <div className="pointer-events-none absolute -top-32 -right-20 h-80 w-80 rounded-full bg-accent/25 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-rose/15 blur-3xl" />

          <div className="relative p-6 sm:p-8 md:p-10">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <h1
                  suppressHydrationWarning
                  className="atelier-title text-4xl leading-none md:text-5xl text-balance wrap-break-word"
                >
                  {getGreeting()}
                  {greetingSuffix(profile?.full_name)}.
                </h1>
                <p className="text-base text-muted-foreground mt-2 max-w-md text-pretty">
                  Let Mila compose an ideal OOTD for today's weather, your palette, and your
                  silhouette.
                </p>
                {profile?.gender ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Styling for {profile.gender}
                    {profile.gender !== "Male"
                      ? ` · Makeup: ${profile.makeup_preference && profile.makeup_preference !== "none" ? profile.makeup_preference : "off"}`
                      : ""}
                    {" · "}
                    <Link to="/style-profile" className="underline hover:text-foreground">
                      Change
                    </Link>
                  </p>
                ) : null}
                <div id="selfie-photo" className="mt-3 scroll-mt-24">
                  <SelfiePhotoWidget hasConsent={!!profile?.photo_consent_at} userId={user?.id} />
                </div>
              </div>
              <ClimateWidget value={climate} onChange={setClimate} />
            </div>

            <div id="hero-generate" className="scroll-mt-24">
              <HeroGeneratorForm
                vibe={vibe}
                onVibeChange={setVibe}
                agenda={agenda}
                onAgendaChange={setAgenda}
                dressCode={dressCode}
                onDressCodeChange={setDressCode}
                indoorOutdoor={indoorOutdoor}
                onIndoorOutdoorChange={setIndoorOutdoor}
                climate={climate}
                generating={generating}
                styleSheetLoading={styleSheetLoading}
                photoPreviewLoading={photoPreviewLoading}
                profileComplete={profileComplete}
                blockedReason={blockedReason}
                checking={checkingLastLook}
                onGenerate={generateLook}
              />
            </div>

            <div className="mt-8">
              <HeroResultPanel
                generating={generating}
                look={look}
                vibe={(shownLook?.vibe as Vibe | null | undefined) ?? vibe}
                climate={climate}
                profile={profile}
                styleSheetLoading={styleSheetLoading}
                styleSheetImageDataUri={styleSheetImageDataUri}
                photoPreviewLoading={photoPreviewLoading}
                savingLook={savingLook}
                lookSaved={lookSaved}
                savedLook={savedLook}
                resultContainerVariants={resultContainerVariants}
                resultItemVariants={resultItemVariants}
                onPreviewStyleSheet={previewStyleSheet}
                onPreviewOnMyPhoto={previewOnMyPhoto}
                onSaveLook={saveLookToHistory}
                onGenerateAnother={generateLook}
                onAskConcierge={handleAskConcierge}
                lookWait={lookWait}
                styleSheetWait={styleSheetWait}
                photoPreviewWait={photoPreviewWait}
                styleSheetNotDrawn={styleSheetNotDrawn}
                lookFromLabel={shownLook?.fromLabel ?? null}
                lookCheckReason={checkingLastLook ? CHECKING_LAST_LOOK : null}
                saveConfirming={saveConfirming}
              />
            </div>
          </div>
        </motion.section>
      </Card>

      <motion.section
        variants={cardItemVariants}
        className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr] mt-10"
      >
        <RecentLooksStrip looks={lookStats?.recentLooks} loading={lookStatsLoading} />

        {profile?.color_season && <DailyPaletteGenerator userColorSeason={profile.color_season} />}
      </motion.section>

      <motion.section
        variants={cardItemVariants}
        className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        <button
          type="button"
          onClick={() => openConcierge()}
          className="atelier-focus-ring flex flex-col items-center gap-2 rounded-card border border-porcelain/40 bg-card p-4 text-center transition-colors hover:bg-accent-soft/40"
        >
          <MessageCircle className="size-5 text-accent" strokeWidth={1.75} aria-hidden="true" />
          <span className="text-xs text-ink">Concierge</span>
        </button>
        <Link
          to="/style-profile"
          className="atelier-focus-ring flex flex-col items-center gap-2 rounded-card border border-porcelain/40 bg-card p-4 text-center transition-colors hover:bg-accent-soft/40"
        >
          <Sparkles className="size-5 text-accent" strokeWidth={1.75} aria-hidden="true" />
          <span className="text-xs text-ink">Style Profile</span>
        </Link>
        <Link
          to="/feed"
          className="atelier-focus-ring flex flex-col items-center gap-2 rounded-card border border-porcelain/40 bg-card p-4 text-center transition-colors hover:bg-accent-soft/40"
        >
          <Images className="size-5 text-accent" strokeWidth={1.75} aria-hidden="true" />
          <span className="text-xs text-ink">Feed</span>
        </Link>
        <Link
          to="/history"
          className="atelier-focus-ring flex flex-col items-center gap-2 rounded-card border border-porcelain/40 bg-card p-4 text-center transition-colors hover:bg-accent-soft/40"
        >
          <HistoryIcon className="size-5 text-accent" strokeWidth={1.75} aria-hidden="true" />
          <span className="text-xs text-ink">History</span>
        </Link>
      </motion.section>

      <UpgradeSlotsDialog open={creditPaywallOpen} onOpenChange={setCreditPaywallOpen} />
    </motion.div>
  );
}
