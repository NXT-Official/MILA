import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import {
  featureMutationOptions,
  featurePressKeys,
  featureRequestKey,
  isLostAnswer,
} from "@/lib/queries/feature-jobs";
import type { PostItem } from "@/lib/outfit-items";
import { detectOotdItems } from "@/lib/publish-ootd";

/** What a finished detection leaves for the feed to read: her post's pieces. */
export type OotdDetectionData = { items: PostItem[] };

export const ootdDetectionKey = (userId: string | undefined, postId: string) =>
  ["ootd-detection", userId, postId] as const;

type PressKeys = Pick<typeof featurePressKeys, "keyFor" | "retire">;

/** The server's calm answer while another detection of hers is still running. */
const STILL_FINISHING = /still finishing your last request/i;
const DEFAULT_RETRY_AFTER_S = 8;
const MAX_RETRY_AFTER_S = 30;

/**
 * The server's "still finishing your last request" answer. Found by shape first
 * (the error's name, or a 429 that is not the plain hourly limit), with the
 * message text as a fallback for a wire that drops the fields. A plain
 * RateLimitExceededError ("Too many requests") is never retried.
 */
export function isDetectionInFlight(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "GenerationInFlightError") return true;
  if (
    (error as { statusCode?: unknown }).statusCode === 429 &&
    error.name !== "RateLimitExceededError"
  ) {
    return true;
  }
  return STILL_FINISHING.test(error.message);
}

const GATEWAY_OR_UNPARSEABLE =
  /unexpected token|unexpected end of json|not valid json|json|<\s*(!doctype|html)|(?:^|\D)50[234](?:\D|$)|bad gateway|service unavailable|gateway time-?out/i;

/**
 * True when the call ended without a Mila answer we can read: a lost answer
 * (timeout, dropped connection, stale bundle) or a reply that is not ours (a
 * gateway 5xx page, a body that is not JSON, nothing thrown but a string). The
 * job may be running or done, so the id is KEPT and the next press reuses it.
 */
export function isUnknownOutcome(error: unknown): boolean {
  if (isLostAnswer(error)) return true;
  if (!(error instanceof Error)) return true;
  if (error instanceof SyntaxError) return true;
  const message = error.message.trim();
  return message === "" || GATEWAY_OR_UNPARSEABLE.test(message);
}

function retryDelayMs(error: unknown): number {
  const seconds = (error as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
  const wanted = typeof seconds === "number" && seconds > 0 ? seconds : DEFAULT_RETRY_AFTER_S;
  return Math.min(Math.max(wanted, 1), MAX_RETRY_AFTER_S) * 1000;
}

/**
 * Runs one detection for one post.
 * - One id per post: the press key is reused after a lost answer (timeout or
 *   dropped connection), so the server replays the same job instead of
 *   charging again. It is retired only when the server really answered.
 * - A "still finishing your last request" 429 (another post's detection is
 *   running) is retried once after the wait, with the same id, while the page
 *   is still mounted. A second 429, or a page that is gone, rethrows: the post
 *   stands and the caller stays silent.
 */
export async function runOotdDetection(args: {
  userId: string;
  postId: string;
  detect?: (postId: string, clientRequestId: string) => Promise<PostItem[]>;
  pressKeys?: PressKeys;
  mounted: () => boolean;
  /** Mint a new id instead of reusing a kept one. See `start` for when that is allowed. */
  fresh?: boolean;
  sleep?: (ms: number) => Promise<void>;
}): Promise<PostItem[]> {
  const detect = args.detect ?? detectOotdItems;
  const pressKeys = args.pressKeys ?? featurePressKeys;
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const fingerprint = featureRequestKey({ postId: args.postId });
  if (args.fresh) {
    pressKeys.retire(
      args.userId,
      "item_detection",
      pressKeys.keyFor(args.userId, "item_detection", fingerprint),
    );
  }
  const id = pressKeys.keyFor(args.userId, "item_detection", fingerprint);
  const retire = () => pressKeys.retire(args.userId, "item_detection", id);
  let retried = false;
  for (;;) {
    try {
      const items = await detect(args.postId, id);
      retire();
      return items;
    } catch (error) {
      if (isDetectionInFlight(error) && !retried && args.mounted()) {
        retried = true;
        await sleep(retryDelayMs(error));
        if (args.mounted()) continue;
      }
      // A lost answer keeps its id: the job may still be running or have finished.
      if (!isUnknownOutcome(error)) retire();
      throw error;
    }
  }
}

type DetectionVariables = { userId: string; postId: string; fresh?: boolean };

/**
 * The mutation's options. The `["ootd-detection", ...]` entry written on
 * success is a HINT only: it has no observer, so it is garbage-collected after
 * gcTime. The feed refetch and the job row are the truth; read it as an
 * enhancement, never as the only record.
 * Callbacks are hook-level so they run even after the
 * page that started the call is gone (TanStack runs them on the mutation, not
 * the component). It also refreshes the feed, where her post's tags show.
 */
export function ootdDetectionMutationOptions(
  queryClient: QueryClient,
  run: (variables: DetectionVariables) => Promise<PostItem[]>,
) {
  const base = featureMutationOptions<DetectionVariables, PostItem[]>(
    "item_detection",
    run,
    queryClient,
    [],
  );
  return {
    ...base,
    onSuccess: (items: PostItem[], variables: DetectionVariables) => {
      queryClient.setQueryData<OotdDetectionData>(
        ootdDetectionKey(variables.userId, variables.postId),
        { items },
      );
    },
    onSettled: (
      data: PostItem[] | undefined,
      error: Error | null,
      variables: DetectionVariables,
    ) => {
      base.onSettled(data, error, variables);
      void queryClient.invalidateQueries({ queryKey: queryKeys.feed(variables.userId) });
    },
  };
}

/**
 * Finds the garments in a just-posted OOTD, after the post exists. `start`
 * never throws and never blocks: a failed or refused detection leaves the post
 * as it is, and the job row (read by useFeatureJob) tells the story.
 */
export function useOotdDetection(userId: string | undefined) {
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const mutation = useMutation(
    ootdDetectionMutationOptions(queryClient, (variables) =>
      runOotdDetection({
        userId: variables.userId,
        postId: variables.postId,
        fresh: variables.fresh,
        mounted: () => mounted.current,
      }),
    ),
  );
  const { mutate } = mutation;

  /**
   * Starts detection for a post. A plain call reuses the post's id, so after a
   * lost answer the server replays the same job and never charges twice.
   *
   * `{ fresh: true }` mints a NEW id, so it charges again. Use it ONLY for
   * "Try again" on a row that FAILED and was refunded. Never for a delivered
   * row (`succeeded` or `persist_failed_delivered`): that is paid for.
   */
  const start = useCallback(
    (postId: string, options: { fresh?: boolean } = {}) => {
      if (!userId) return;
      mutate({ userId, postId, ...(options.fresh ? { fresh: true } : {}) });
    },
    [userId, mutate],
  );

  return { start, isPending: mutation.isPending };
}
