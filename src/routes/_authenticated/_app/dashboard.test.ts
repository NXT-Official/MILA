import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The dashboard route is wired to server functions, the app shell and the
// query cache, so it can't be rendered under bun:test. These checks pin the
// ordering rules inside its async handlers by reading the source, the same way
// src/lib/security-boundaries.test.ts pins its guarantees.
const source = readFileSync(new URL("./dashboard.tsx", import.meta.url), "utf8");

/** The text of one handler, from its `async function` line up to the next one. */
function handler(name: string) {
  const start = source.indexOf(`async function ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("\n  async function ", start + 1);
  const afterwards = next === -1 ? source.length : next;
  return source.slice(start, afterwards);
}

/** The expression that decides whether a portrait call in flight still counts. */
function portraitInFlight() {
  const start = source.indexOf("const portraitInFlight =");
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf(";", start));
}

describe("R7: generation state lives in TanStack Query, never in page state", () => {
  test("no page-local busy flags", () => {
    expect(source).not.toMatch(/const \[(generating|styleSheetLoading|photoPreviewLoading),/);
  });

  test("each generation is a mutation under its own key", () => {
    for (const kind of ["look", "style_sheet", "photo_preview"]) {
      expect(source).toMatch(new RegExp(`generationMutationOptions<[\\s\\S]*?>\\(\\s*"${kind}"`));
    }
  });

  test("every press sends a request id from the tab's ledger", () => {
    for (const [name, kind] of [
      ["generateLook", "look"],
      ["generateStyleSheetVisual", "style_sheet"],
      ["previewOnMyPhoto", "photo_preview"],
    ]) {
      const body = handler(name);
      // The ledger is kept per member (N2): begin(userId, kind, key).
      expect(body).toMatch(new RegExp(`generationRequests\\.begin\\(\\s*user\\.id,\\s*"${kind}"`));
      expect(body.slice(body.indexOf("mutateAsync("))).toContain("clientRequestId");
    }
  });

  test("a double press is refused in the same tick, before anything is sent", () => {
    const body = handler("generateLook");
    const guard = body.indexOf("queryClient.isMutating(");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf("mutateAsync("));
  });

  test("an id is kept only when the answer was lost; a real answer retires it", () => {
    for (const name of ["generateLook", "generateStyleSheetVisual", "previewOnMyPhoto"]) {
      const inCatch = handler(name).slice(handler(name).indexOf("catch (e)"));
      expect(inCatch).toContain("isUnknownGenerationOutcome(e)");
      expect(inCatch).toContain("generationRequests.settle(");
    }
  });

  test("following a job row is gated on the table answering (migration missing: today's path)", () => {
    expect(source).toMatch(/const jobsLive = lookJobQuery\.data\?\.status === "ready"/);
    // The look to bring back is only decided once the table answered...
    const decision = source.slice(
      source.indexOf("const lookDecision ="),
      source.indexOf("lookToRecover("),
    );
    expect(decision).toContain("jobsLive &&");
    // ...and only applied then.
    const effect = source.slice(source.indexOf("const continueWithStyleSheet"));
    expect(effect).toContain("if (!jobsLive");
  });

  test("a missing table is asked about by the look row only (M1)", () => {
    for (const kind of ["style_sheet", "photo_preview"]) {
      const start = source.indexOf(`useLatestGenerationJob(userId, "${kind}"`);
      expect(start).toBeGreaterThan(-1);
      expect(source.slice(start, source.indexOf("});", start))).toContain("enabled: jobsLive");
    }
  });
});

describe("I1: a look shown as composing can never finish and vanish", () => {
  test("a changed press reads her job row before anything is sent", () => {
    const body = handler("generateLook");
    // The plan wraps pressDecision with what to do when the read times out or fails (NEW-M1).
    const check = body.indexOf("changedPressPlan(");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(body.indexOf("mutateAsync("));
    expect(check).toBeLessThan(body.indexOf("setLook(null)"));
    expect(body).toContain('generationRequests.pending(user.id, "look")');
  });

  test("Create waits for her look row's first answer", () => {
    expect(handler("generateLook").split("\n")[1]).toContain("checkingLastLook");
    expect(source).toContain("checking={checkingLastLook}");
  });

  test("a look shown as composing is remembered and lands when it succeeds", () => {
    expect(source).toContain("watchedLookJobs.add(");
    expect(source).toMatch(/watched: watchedLookJobs\.has\(lookJob\.id\)/);
  });

  test("a look she already saved is never brought back, and saving uses the look's own vibe", () => {
    const effect = source.slice(source.indexOf("const continueWithStyleSheet"));
    expect(effect).toContain("if (savedCheck.data === true) return;");
    expect(handler("saveLookToHistory")).toContain("vibe: shownLook?.vibe ?? vibe");
  });
});

describe("NEW-I1: recovery is judged by the time it is decided, never the time the page opened", () => {
  /** The expression that decides which look comes back. */
  function lookDecision() {
    const start = source.indexOf("const lookDecision =");
    expect(start).toBeGreaterThanOrEqual(0);
    return source.slice(start, source.indexOf("const savedCheck", start));
  }

  test("the decision reads the server clock itself, not a time captured earlier", () => {
    const decision = lookDecision();
    expect(decision).toContain("decideLookRecovery(");
    expect(decision).toContain("clock: generationClock");
    expect(decision).not.toContain("serverNow");
    expect(decision).not.toMatch(/\bnow:/);
  });

  test("her last press goes in as a device time, converted on the same clock", () => {
    expect(lookDecision()).toContain("lastPressAt: lookClearedAt");
  });
});

describe("NEW-M1: the check before a changed press is visible, bounded and never fires later", () => {
  test("it is React state shared by every mount, and Create shows it", () => {
    expect(source).toMatch(/useSyncExternalStore\(\s*lastLookPressCheck\.subscribe/);
    const checking = source.slice(source.indexOf("const checkingLastLook ="));
    expect(checking.slice(0, checking.indexOf(";"))).toContain("pressChecking");
    expect(source).toContain('"Checking your last look…"');
    // "Try another look" waits too, and says why.
    expect(source).toMatch(/lookCheckReason=\{checkingLastLook \? CHECKING_LAST_LOOK : null\}/);
  });

  test("the first read after a reload holds Create for at most the check's time limit", () => {
    expect(source).toMatch(/useLongerThan\(\s*firstLookRead,\s*JOB_CHECK_TIMEOUT_MS\s*\)/);
  });

  test("the press reads her row within a time limit, and a timeout reuses her unanswered id", () => {
    const body = handler("generateLook");
    // Round 3: the check reads her unanswered ids directly (readOwnJobsWithin).
    const read = body.indexOf("readOwnJobsWithin(");
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(body.indexOf("setLook(null)"));
    expect(body).toContain("lastLookPressCheck.start()");
    expect(body).toContain("lastLookPressCheck.finish()");
    expect(body).toMatch(/generationRequests\.reuse\(\s*user\.id,\s*"look"/);
  });

  test("an offline press is refused before anything is cleared or sent", () => {
    const body = handler("generateLook");
    const refuse = body.indexOf("deviceIsOffline()");
    expect(refuse).toBeGreaterThan(-1);
    expect(refuse).toBeLessThan(body.indexOf("readOwnJobsWithin("));
    expect(refuse).toBeLessThan(body.indexOf("setLook(null)"));
    expect(refuse).toBeLessThan(body.indexOf("mutateAsync("));
  });

  test("a lost answer's row is read within the same time limit", () => {
    const start = source.indexOf("const rowSpeaksFor");
    const body = source.slice(start, source.indexOf("};", start));
    expect(body).toContain("readLatestJobWithin(");
    expect(body).not.toContain("fetchQuery(");
  });
});

describe("NEW-M2: the server clock learns only from fresh press times", () => {
  test("her rows teach the clock through the freshness rule", () => {
    expect(source).toContain("learnServerClock(generationClock, job, own)");
    expect(source).not.toContain("generationClock.learn(");
  });
});

describe("a press the server refuses replaced nothing", () => {
  test("her last-press mark goes back to where it was", () => {
    const body = handler("generateLook");
    const inCatch = body.slice(body.indexOf("catch (e)"));
    const refused = inCatch.slice(0, inCatch.indexOf("rowSpeaksFor("));
    expect(body).toContain("const clearedBefore = lookClearedAt;");
    expect(refused).toContain("lookClearedAt = clearedBefore;");
  });
});

describe("round 3: her own job lands even when another device's newer job is the latest row", () => {
  /** The text of one top-level declaration in the component, up to its first `;` at the end of a line. */
  function declaration(name: string) {
    const start = source.indexOf(`const ${name} =`);
    expect(start).toBeGreaterThanOrEqual(0);
    return source.slice(start, source.indexOf(";\n", start));
  }

  test("her unanswered ids are read directly, only when one of them is not the latest row", () => {
    expect(source).toMatch(/ownGenerationJobsQueryOptions\(\s*userId,\s*"look",\s*pendingLookIds/);
    const needed = declaration("ownLookReadNeeded");
    expect(needed).toContain("jobsLive &&");
    expect(needed).toContain("pendingLookIds.some(");
    expect(source).toContain("enabled: ownLookReadNeeded");
  });

  test("the page follows her own job when it is behind another device's newer one", () => {
    expect(declaration("herLookJob")).toContain("ownJobBehindLatest(");
    expect(declaration("lookJob")).toContain("herLookJob");
    // Her own job shown as composing even when it is not the latest row.
    expect(declaration("lookRunning")).toContain("herLookJob");
  });

  test("another device's look waits while a press of hers is unanswered", () => {
    // Round 4: the hold now lifts once her ids are read and none is live
    // (ownPressesStillLive, pinned with its own test below).
    expect(declaration("lookDecision")).toContain("ownPending: ownPressesStillLive");
  });

  test("the check before a changed press reads her ids, and the page follows what it found", () => {
    const body = handler("generateLook");
    expect(body).toMatch(/readOwnJobsWithin\(\s*user\.id,\s*"look",\s*pendingIds/);
    expect(body).toMatch(
      /setQueryData\(\s*generationJobKeys\.own\(\s*user\.id,\s*"look",\s*pendingIds\s*\)/,
    );
  });
});

describe("round 3: attaching or recovering clears the screen, so her own look can land", () => {
  test("the screen is cleared before she is told", () => {
    const body = handler("generateLook");
    const clear = body.indexOf("setLook(null)");
    expect(clear).toBeGreaterThan(-1);
    // Round 4 (I-B): a look that already answers the press is kept and told
    // "ready" before this point; the attach and recover outcomes still clear first.
    expect(clear).toBeLessThan(body.indexOf('answeredBy === "attach"'));
    expect(clear).toBeLessThan(body.indexOf('answeredBy === "recover"'));
  });
});

describe("round 3 ruling: a failed check never refuses a press", () => {
  test("there is no refusal branch left", () => {
    expect(source).not.toContain("check_failed");
  });
});

describe("round 3: a look answered under a reused id keeps its own vibe and weather", () => {
  test("each press keeps what it asked for with its id", () => {
    expect(handler("generateLook")).toMatch(
      /generationRequests\.begin\(\s*user\.id,\s*"look",\s*requestKey,\s*\{\s*vibe: payload\.vibe,\s*weather: payload\.weather/,
    );
  });

  test("the answer is shown and saved with that request's vibe, then checked against its job row", () => {
    const body = handler("generateLook");
    // Round 4 (R3-1): settled from the answer (answerAsked), then confirmed
    // from its job row (confirmLookAsked reads her row for this id).
    const asked = body.indexOf("answerAsked(");
    expect(asked).toBeGreaterThan(-1);
    expect(asked).toBeLessThan(body.indexOf("const shown: ShownLook"));
    expect(body).toContain("vibe: asked.vibe");
    expect(body).toContain("weatherLabel: asked.weatherLabel");
    // Round 5: the confirmation is shared with Save (confirmLook), which reads
    // her row for this look's own request id.
    expect(body).toContain("confirmLook(shown)");
    const confirm = source.slice(source.indexOf("function confirmLook("));
    expect(confirm.slice(0, confirm.indexOf("\n  }\n"))).toMatch(
      /confirmLookAsked\(\s*user\.id,\s*\{\s*requestId,/,
    );
    // Saving still uses the look's own vibe (shownLook), never the form's.
    expect(handler("saveLookToHistory")).toContain("vibe: shownLook?.vibe ?? vibe");
  });
});

describe("a late portrait preview never lands on a different look", () => {
  test("each preview takes a token before it starts", () => {
    const body = handler("previewOnMyPhoto");
    expect(body).toContain("photoPreviewRun.start()");
  });

  test("the portrait is applied only if its token is still current", () => {
    const body = handler("previewOnMyPhoto");
    const guard = body.indexOf("photoPreviewRun.isCurrent(run)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf("setLook("));
  });

  test("a stale preview cannot toast, stop the spinner or open the paywall", () => {
    const body = handler("previewOnMyPhoto");
    const inCatch = body.slice(body.indexOf("catch (e)"));
    expect(inCatch).toContain("photoPreviewRun.isCurrent(run)");
    // R7: the spinner is no longer a useState flag a late preview could clear;
    // it is derived from the calls in flight, and only the current run counts.
    expect(portraitInFlight()).toContain("photoPreviewRun.isCurrent(");
  });

  test("composing a new look retires any portrait still rendering", () => {
    const body = handler("generateLook");
    expect(body).toContain("photoPreviewRun.invalidate()");
    // Invalidating the run is what stops its spinner (see portraitInFlight).
    expect(portraitInFlight()).toContain("photoPreviewRun.isCurrent(");
    expect(source).toMatch(/const photoPreviewLoading =\s*\n?\s*portraitInFlight/);
  });

  test("a new look cannot be started while a portrait is rendering", () => {
    const guard = handler("generateLook").split("\n")[1] ?? "";
    expect(guard).toContain("photoPreviewLoading");
  });
});

describe("a throw while asking for notifications cannot strand a spinner", () => {
  for (const name of ["generateStyleSheetVisual", "previewOnMyPhoto"]) {
    test(`${name} asks inside its try block`, () => {
      const body = handler(name);
      const ask = body.indexOf("requestNotificationPermission()");
      expect(ask).toBeGreaterThan(-1);
      expect(ask).toBeGreaterThan(body.indexOf("try {"));
    });
  }
});

describe("round 4: the e2e regression, her refused press's earlier job still lands", () => {
  test("her own-ids read keeps looking for a missing row while one could appear, and not during her own call", () => {
    const start = source.indexOf("ownGenerationJobsQueryOptions(userId");
    const options = source.slice(start, source.indexOf("})", start));
    expect(options).toContain("rowExpectedUntil: ownRowsExpectedUntil(pendingLookEntries)");
    expect(options).toContain("enabled: ownLookReadNeeded && !lookInFlight");
  });
});

describe("round 4: I-A, a press after a check with no answer goes under its own request's id", () => {
  test("the plan is given this request's own unanswered id", () => {
    expect(handler("generateLook")).toMatch(
      /changedPressPlan\(\s*read,\s*earlier,\s*generationClock\.now\(\),\s*reaper\.isAlive,\s*sameRequest\?\.id/,
    );
  });
});

describe("round 4: I-B, a look that landed during the check is never wiped", () => {
  test("after the check, a look that answers the press is kept, before anything is cleared", () => {
    const body = handler("generateLook");
    const keep = body.indexOf("lookAnswersPress(");
    expect(keep).toBeGreaterThan(body.indexOf("readOwnJobsWithin("));
    expect(keep).toBeLessThan(body.indexOf("setLook(null)"));
    expect(keep).toBeLessThan(body.indexOf("styleSheetRun.invalidate()"));
    // Round 5 (N-2): the look on screen is read from the mark set in the same
    // call that puts a look there, not from a ref written after the render.
    expect(body).toContain("lookOnScreenMark.jobId()");
  });
});

describe("round 4: R3-1, a look's vibe is settled from the answer, and a save waits for it", () => {
  test("the answer's job is looked up at arrival", () => {
    const body = handler("generateLook");
    expect(body).toContain("findCachedJob(");
    expect(body).toContain("answerAsked(");
    expect(body).toContain("askedConfirmed:");
  });

  test("a save of a look whose vibe is not yet confirmed confirms it first", () => {
    const body = handler("saveLookToHistory");
    // Round 5 (N-3): settleLookForSave confirms an unconfirmed look first, or
    // answers null so the save is refused.
    const confirm = body.indexOf("settleLookForSave(");
    expect(confirm).toBeGreaterThan(-1);
    expect(confirm).toBeLessThan(body.indexOf("saveOutfit("));
  });
});

describe("round 4: R3-3 gaps", () => {
  test("a lost look answer is checked against her own ids", () => {
    const start = source.indexOf("const rowSpeaksFor");
    const body = source.slice(start, source.indexOf("\n  };", start));
    expect(body).toContain("readOwnJobsWithin(");
  });

  test("her own job behind a newer row is counted as waiting and handed to the reaper", () => {
    expect(source).toMatch(
      /useReapStaleJobs\(\s*reaper,\s*userId,\s*\[latestLookJob,\s*herLookJob,\s*sheetJob,\s*portraitJob\]/,
    );
    const waiting = source.slice(source.indexOf("const anyWaiting ="));
    expect(waiting.slice(0, waiting.indexOf(";"))).toContain("herLookJob");
  });
});

describe("round 4: the hold on other looks lifts once her ids are read", () => {
  test("the decision holds only while her presses are still live", () => {
    const start = source.indexOf("const lookDecision =");
    const decision = source.slice(start, source.indexOf("const savedCheck", start));
    expect(decision).toContain("ownPending: ownPressesStillLive");
    expect(source).toMatch(/const ownPressesStillLive =[\s\S]*?ownPressesHold\(/);
  });
});

describe("round 4: a refusal never retires a borrowed id", () => {
  test("only this request's own id is retired on a real refusal", () => {
    const body = handler("generateLook");
    const inCatch = body.slice(body.indexOf("catch (e)"));
    expect(inCatch).toContain("refusalRetires(");
  });
});

describe("round 4: the first-read wait only when she has a look press unanswered", () => {
  test("a fresh mount with nothing unanswered never waits", () => {
    const start = source.indexOf("const firstLookRead =");
    expect(source.slice(start, source.indexOf(";", start))).toContain("pendingLookIds.length > 0");
  });
});

describe("round 5 (N-1): the hold keeps holding while her press may still be live", () => {
  test("the hold is given her ids and the time her newest press's row can still appear", () => {
    const start = source.indexOf("const ownPressesStillLive =");
    const hold = source.slice(start, source.indexOf("const lookDecision =", start));
    expect(hold).toContain("requestIds: pendingLookIds");
    expect(hold).toContain("rowExpectedUntil: ownRowsExpectedUntil(pendingLookEntries)");
    expect(hold).not.toContain("firstReadInFlight");
  });
});

describe("round 5 (N-3, N-4): Save never stores a guess, and saves once", () => {
  test("a second tap while a save runs does nothing, and Save disables before anything is awaited", () => {
    const body = handler("saveLookToHistory");
    const guard = body.indexOf("lookSaveCheck.start()");
    const saving = body.indexOf("setSavingLook(true)");
    const firstAwait = body.indexOf("await ");
    expect(guard).toBeGreaterThan(-1);
    expect(saving).toBeGreaterThan(guard);
    expect(saving).toBeLessThan(firstAwait);
    expect(body).toContain("lookSaveCheck.finish()");
  });

  test("an unconfirmed look is confirmed first, and refused if it cannot be", () => {
    const body = handler("saveLookToHistory");
    const settle = body.indexOf("settleLookForSave(");
    expect(settle).toBeGreaterThan(-1);
    expect(settle).toBeLessThan(body.indexOf("saveOutfit("));
    expect(body).toContain("toast.error(SAVE_UNCONFIRMED)");
    expect(source).toContain(
      `const SAVE_UNCONFIRMED = "We couldn't confirm this look yet. Try saving again in a moment."`,
    );
  });

  test("while a confirmation runs, Save says so and waits", () => {
    expect(source).toMatch(/useSyncExternalStore\(\s*lookConfirmCheck\.subscribe/);
    expect(source).toContain("saveConfirming={saveConfirming}");
  });
});

describe("round 5 (N-2): the look on screen is marked the moment it is set", () => {
  test("every look the page puts on screen marks it first, synchronously", () => {
    const sets = [...source.matchAll(/setLook\((null|shown|recovered)\);/g)];
    expect(sets.length).toBeGreaterThanOrEqual(3);
    for (const set of sets) {
      const before = source.slice(Math.max(0, (set.index ?? 0) - 120), set.index);
      expect(before).toContain(`lookOnScreenMark.set(${set[1]});`);
    }
  });

  test("the check reads the mark, not a value written after the render", () => {
    const body = handler("generateLook");
    expect(body).toContain("lookOnScreenMark.jobId()");
    expect(body).not.toContain("liveLook.current");
  });
});

describe("round 5 (m-3): an answer that is not Mila's keeps the id, and is told calmly", () => {
  test("every generation call goes through the guarded fetch", () => {
    for (const fn of ["generate", "generateStyleSheetFn", "generatePhotoPreviewFn"]) {
      // The call's own options, up to its closing parenthesis.
      expect(source).toMatch(new RegExp(`\\b${fn}\\(\\{[^)]*fetch: generationFetch`));
    }
  });

  test("a lost answer is told with the calm copy, never the raw error", () => {
    for (const [name, kind] of [
      ["generateLook", "look"],
      ["generateStyleSheetVisual", "style_sheet"],
      ["previewOnMyPhoto", "photo_preview"],
    ]) {
      expect(handler(name)).toContain(`toast.error(lostAnswerNotice("${kind}"))`);
    }
  });

  test("a refusal because her session is reconnecting is told calmly", () => {
    expect(handler("generateLook")).toContain("isSessionRefusal(e)");
  });
});

describe("round 5 (m-4): look_generated once per job, with the job's own vibe", () => {
  test("the event is decided by the answer's job, never fired for a replay", () => {
    const body = handler("generateLook");
    expect(body).toContain("lookEventFor(");
    expect(body).toContain("replayed: outfit.replayed");
    expect(body).toContain("vibe: asked.vibe");
    expect(body).not.toContain('"look_generated", { vibe }');
  });
});

describe("generation flags survive a tab switch (they live at the app shell)", () => {
  // A member who switches tabs mid-generation unmounts the dashboard. When
  // the flags lived here as useState they reset to idle: the returning member
  // saw no progress, and the re-enabled CTA was one tap from charging a
  // second generation while the first still ran.
  test("the flags are written to the shared look context", () => {
    // This route derives its busy state from the generation mutations and
    // her job rows (which also survive a reload) and mirrors it into the
    // app-shell flags, so anything reading the shell sees the same thing.
    const block = source.match(/const \{[^}]*\} = useCurrentLook\(\)/)?.[0] ?? "";
    for (const flag of ["setGenerating", "setStyleSheetLoading", "setPhotoPreviewLoading"]) {
      expect(block).toContain(flag);
    }
    expect(source).toContain("setGenerating(generating);");
    expect(source).toContain("setStyleSheetLoading(styleSheetLoading);");
    expect(source).toContain("setPhotoPreviewLoading(photoPreviewLoading);");
  });

  test("none of the flags is still held as route-local state", () => {
    for (const gone of [
      "const [generating, setGenerating] = useState",
      "const [styleSheetLoading, setStyleSheetLoading] = useState",
      "const [photoPreviewLoading, setPhotoPreviewLoading] = useState",
    ]) {
      expect(source).not.toContain(gone);
    }
  });
});

describe("every generated look lands in history automatically", () => {
  test("generateLook auto-saves after the visual attempt — with or without a sheet", () => {
    const body = handler("generateLook");
    const visual = body.indexOf("await generateStyleSheetVisual(");
    const save = body.indexOf("autoSaveLook(shown, sheetUri)");
    expect(visual).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(-1);
    expect(visual).toBeLessThan(save);
    // No consent is not an early return any more: the look is still saved.
    expect(body).not.toContain("if (!profile.photo_consent_at) return;");
  });

  test("one generation can never produce two rows", () => {
    // The manual path yields to the automatic save while it is in flight.
    expect(handler("saveLookToHistory")).toContain("if (autoSaveInFlightRef.current) return;");
    const body = handler("autoSaveLook");
    expect(body).toContain("autoSaveInFlightRef.current = true;");
    expect(body).toContain("autoSaveInFlightRef.current = false;");
  });

  test("the manual save no longer demands a visual", () => {
    expect(source).not.toContain("needs its visual before it can be saved");
    expect(handler("saveLookToHistory")).toContain("imageDataUri: imageToSave ?? null");
  });
});
