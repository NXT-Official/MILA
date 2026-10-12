import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/constants/query-keys";
import { SEASON_HEX_MATRIX, SEASONS_MASTER_DATA } from "@/constants/style-profile";
import { parseAnalysisJobRow, type AnalysisJobState } from "@/lib/queries/analysis-jobs";
import { asMarkup, renderAppMarkup } from "../../../tests/helpers/render-app-markup";
import { ColorReadRecoveryCard, ColorReadRecoveryView } from "./color-read-recovery-card";

const USER = "user-1";
/** Pinned: 7 Oct 2026, 13:00 local. */
const NOW = new Date(2026, 9, 7, 13, 0, 0).getTime();
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

const STORED = {
  profile: {
    ...SEASONS_MASTER_DATA.AUTUMN_DEEP,
    faceShape: "Oval Frame",
    bodyType: "Hourglass",
    stylistNote: "Your features carry real depth.",
    fullPalette: SEASON_HEX_MATRIX.AUTUMN_DEEP,
  },
  telemetry: {
    pass1Raw: {
      ambientLighting: "clear_daylight",
      biologicalUndertone: "warm_gold",
      computedContrast: "high",
    },
    interceptTriggered: false,
    gatekeeperNotes: [],
    pass2OverrideInputs: {
      ambientLighting: "clear_daylight",
      biologicalUndertone: "warm_gold",
      computedContrast: "high",
      sensorClippingEvent: false,
    },
    forcedDiagnostic: false,
  },
};

function state(overrides: Record<string, unknown> = {}): AnalysisJobState {
  return {
    status: "ready",
    job: parseAnalysisJobRow({
      id: "job-1",
      kind: "color_read",
      client_request_id: "req-1",
      status: "succeeded",
      credit_state: "charged",
      result: STORED,
      error_code: null,
      deadline_at: iso(NOW + 4 * MIN),
      created_at: iso(NOW - 2 * MIN),
      completed_at: iso(NOW - MIN),
      ...overrides,
    }),
  };
}

const RUNNING = { status: "running", result: null, completed_at: null };
const FAILED = { status: "failed", result: null, error_code: "deadline_exceeded" };

async function card(
  seeded: AnalysisJobState,
  props: Partial<Parameters<typeof ColorReadRecoveryCard>[0]> = {},
) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(queryKeys.analysisJob(USER, "color_read"), seeded);
  const markup = await renderAppMarkup(
    <ColorReadRecoveryCard readJobId={null} onUseResult={() => {}} now={() => NOW} {...props} />,
    { userId: USER, queryClient },
  );
  queryClient.clear();
  return markup;
}

/** The visible text of the markup: tags dropped, entities read. */
function visibleText(markup: string) {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

describe("ColorReadRecoveryCard", () => {
  test("running: still reading, she can leave, nothing to press", async () => {
    const markup = await card(state(RUNNING));
    expect(markup).toContain(asMarkup("Mila is still reading your colors."));
    expect(markup).toContain(asMarkup("You can leave this page. Your result will be here."));
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain("<button");
  });

  test("ready: See my result and Dismiss, each at least 44px tall", async () => {
    const markup = await card(state());
    expect(markup).toContain(asMarkup("Your color read is ready."));
    expect(markup).toMatch(/<button[^>]*h-11[^>]*>[^<]*See my result/);
    expect(markup).toMatch(/<button[^>]*h-11[^>]*>[^<]*Dismiss/);
  });

  test("failed: the credit came back, and Try again starts a new read", async () => {
    const markup = await card(state(FAILED), { onTryAgain: () => {} });
    expect(markup).toContain(
      asMarkup("Your last color read didn't finish. Any credit it used has been returned."),
    );
    expect(markup).toMatch(/<button[^>]*>[^<]*Try again/);
  });

  test("failed, with nowhere to start a new read: Dismiss instead of a dead Try again", async () => {
    const markup = await card(state(FAILED));
    expect(markup).not.toContain("Try again");
    expect(markup).toMatch(/<button[^>]*>[^<]*Dismiss/);
  });

  test("never her saved read, and nothing while the table is missing", async () => {
    expect(await card(state(), { readJobId: "job-1" })).not.toContain("color read is ready");
    expect(await card({ status: "unavailable" })).not.toContain("<section");
    expect(await card({ status: "ready", job: null })).not.toContain("<section");
  });

  test("no visible string has an em or en dash, or the old studio name", async () => {
    for (const seeded of [state(RUNNING), state(), state(FAILED)]) {
      const text = visibleText(await card(seeded, { onTryAgain: () => {} }));
      expect(text).not.toMatch(/[–—]/);
      expect(text).not.toMatch(/seoul|atelier/i);
    }
  });

  test("gold stays a fill: no text uses the accent color", async () => {
    for (const seeded of [state(RUNNING), state(), state(FAILED)]) {
      expect(await card(seeded, { onTryAgain: () => {} })).not.toMatch(/\btext-accent\b/);
    }
  });
});

describe("ColorReadRecoveryView", () => {
  test("lost, with the same request to resend: Try again, never charged twice", () => {
    const markup = renderToStaticMarkup(
      <ColorReadRecoveryView offer="lost" resendable onTryAgain={() => {}} />,
    );
    expect(markup).toContain(asMarkup("The connection dropped before your color read came back."));
    expect(markup).toContain(asMarkup("Try again. You won't be charged twice."));
    expect(markup).toMatch(/<button[^>]*>[^<]*Try again/);
  });

  test("lost, with nothing to resend: no promise about the charge", () => {
    const markup = renderToStaticMarkup(
      <ColorReadRecoveryView offer="lost" resendable={false} onTryAgain={() => {}} />,
    );
    expect(markup).not.toContain("charged");
    expect(markup).toContain("Please try again.");
  });

  test("the running spinner stops for reduced motion and is hidden from screen readers", () => {
    const markup = renderToStaticMarkup(<ColorReadRecoveryView offer="running" />);
    expect(markup).toMatch(
      /animate-spin[^"]*motion-reduce:animate-none|motion-reduce:animate-none[^"]*animate-spin/,
    );
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"/);
  });
});
