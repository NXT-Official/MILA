import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import {
  featureJobKeys,
  parseFeatureJobRow,
  type FeatureJobState,
} from "@/lib/queries/feature-jobs";
import {
  CONCIERGE_COPY,
  conciergeComposerState,
  conciergePendingTurns,
} from "@/hooks/use-concierge-send";
import { asMarkup, renderAppMarkup } from "../../../tests/helpers/render-app-markup";
import { ConciergeChat } from "./concierge-chat";
import { MessageBubble } from "./message-bubble";
import type { Msg } from "./types";

const USER = "11111111-1111-4111-8111-111111111111";
const REQUEST = "55555555-5555-4555-8555-555555555555";
const MESSAGE = "What goes with olive trousers?";

const CHAT_SOURCE = readFileSync(join(import.meta.dir, "concierge-chat.tsx"), "utf8");
const BUBBLE_SOURCE = readFileSync(join(import.meta.dir, "message-bubble.tsx"), "utf8");

function runningRow(overrides: Record<string, unknown> = {}) {
  // The row is judged against the real clock when the chat renders.
  const now = Date.now();
  const job = parseFeatureJobRow({
    id: "66666666-6666-4666-8666-666666666666",
    kind: "concierge",
    client_request_id: REQUEST,
    status: "running",
    credit_state: "charged",
    result: null,
    error_code: null,
    input: { message: MESSAGE, lookId: null, imageUrl: null, conversationId: null, saveTurn: true },
    deadline_at: new Date(now + 4 * 60_000).toISOString(),
    created_at: new Date(now - 30_000).toISOString(),
    completed_at: null,
    ...overrides,
  });
  if (!job) throw new Error("fixture row did not parse");
  return job;
}

async function renderChat(state: FeatureJobState | undefined) {
  const queryClient = new QueryClient();
  if (state) queryClient.setQueryData(featureJobKeys.latest(USER, "concierge"), state);
  return renderAppMarkup(<ConciergeChat look={null} onSelectLook={() => {}} />, {
    userId: USER,
    queryClient,
  });
}

afterEach(() => {
  conciergePendingTurns.clear(USER, REQUEST);
});

describe("a reply she paid for is never lost (recovery on the page)", () => {
  test("reload with her running turn shows the pending bubble, Mila composing, and that she can leave", async () => {
    conciergePendingTurns.set(USER, { id: REQUEST, at: Date.now() });
    const html = await renderChat({ status: "ready", job: runningRow() });
    expect(html).toContain(asMarkup(MESSAGE));
    expect(html).toContain("Mila is composing");
    expect(html).toContain(asMarkup(CONCIERGE_COPY.leave));
    expect(CONCIERGE_COPY.leave).toBe("You can leave this page. Mila's reply will be here.");
    // Not the empty welcome: her turn is on screen.
    expect(html).not.toContain("How can I help you style today?");
  });

  test("a new-chat turn that is not her press from this browser is not pulled into the chat", async () => {
    const html = await renderChat({ status: "ready", job: runningRow() });
    expect(html).not.toContain(asMarkup(MESSAGE));
    expect(html).not.toContain(asMarkup(CONCIERGE_COPY.leave));
  });

  test("while Mila composes her recovered turn, Send and the quick prompts wait", async () => {
    conciergePendingTurns.set(USER, { id: REQUEST, at: Date.now() });
    const html = await renderChat({ status: "ready", job: runningRow() });
    expect(html).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*disabled="")[^>]*>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Build an outfit for today/);
  });

  test("migration missing: today's chat, no promise she can leave, nothing recovered", async () => {
    conciergePendingTurns.set(USER, { id: REQUEST, at: Date.now() });
    const html = await renderChat({ status: "unavailable" });
    expect(html).toContain("How can I help you style today?");
    expect(html).not.toContain(asMarkup(CONCIERGE_COPY.leave));
    expect(html).not.toContain(asMarkup(MESSAGE));
  });

  test("a polite live region is there for a recovered reply", async () => {
    const html = await renderChat({ status: "ready", job: null });
    expect(html).toMatch(
      /role="status"[^>]*aria-live="polite"|aria-live="polite"[^>]*role="status"/,
    );
  });

  test("the cost of a reply is said under the composer", async () => {
    const html = await renderChat(undefined);
    expect(html).toContain(CONCIERGE_COPY.cost);
    expect(CONCIERGE_COPY.cost).toBe("Each reply uses 1 credit.");
  });
});

describe("Send never drops her photo (CONCIERGE)", () => {
  test("Send is blocked during photo prep, with an honest status", () => {
    const state = conciergeComposerState({
      input: "Does this suit me?",
      sending: false,
      preparing: true,
      composing: false,
    });
    expect(state.sendDisabled).toBe(true);
    expect(state.promptsDisabled).toBe(true);
    expect(state.status).toBe("Preparing your photo…");
    expect(
      conciergeComposerState({
        input: "Does this suit me?",
        sending: false,
        preparing: false,
        composing: false,
      }).sendDisabled,
    ).toBe(false);
  });

  test("the chat wires the composer state to Send, the prompts and the status line", () => {
    expect(CHAT_SOURCE).toMatch(/disabled=\{composer\.sendDisabled\}/);
    expect(CHAT_SOURCE).toMatch(/disabled=\{composer\.promptsDisabled\}/);
    expect(CHAT_SOURCE).toMatch(/role="status"[\s\S]{0,200}composer\.status/);
    // send() itself refuses while a photo is being prepared (Enter in the field).
    expect(CHAT_SOURCE).toMatch(/if \(!trimmed \|\| preparing/);
  });

  test("retry keeps the photo: the retry reuses the uploaded URL or the kept file", () => {
    expect(CHAT_SOURCE).not.toContain("retryId == null ? attachment : null");
    expect(CHAT_SOURCE).toContain("keptFiles.current.get(retryId)");
    expect(CHAT_SOURCE).toMatch(/uploadedUrl: userMsg\.uploadedUrl \?\? null/);
    expect(CHAT_SOURCE).toMatch(/previousRequestId: userMsg\.clientRequestId \?\? null/);
  });

  test("persistExchange checks its errors (no fire-and-forget)", () => {
    expect(CHAT_SOURCE).not.toContain("void persistExchange(");
    expect(CHAT_SOURCE).not.toContain("// best-effort");
  });
});

describe("the message bubble", () => {
  const reply: Msg = {
    id: 2,
    role: "assistant",
    content: "Cream and rust.",
    ts: new Date(2026, 9, 7, 13, 0).getTime(),
    unsaved: true,
    clientRequestId: REQUEST,
  };

  test("a reply that could not be saved says so and offers Save (44 px)", async () => {
    const html = await renderAppMarkup(
      <MessageBubble msg={reply} onRetry={() => {}} onSave={() => {}} sending={false} />,
    );
    expect(html).toContain(asMarkup(CONCIERGE_COPY.unsaved));
    expect(html).toMatch(/<button[^>]*class="[^"]*min-h-11[^"]*"[^>]*>.*?Save/);
  });

  test("Save shows that it is working", async () => {
    const html = await renderAppMarkup(
      <MessageBubble msg={reply} onRetry={() => {}} onSave={() => {}} saving sending={false} />,
    );
    expect(html).toContain("Saving…");
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });

  test("a failed turn carries the failure copy when there is one, and Try again is 44 px", async () => {
    const html = await renderAppMarkup(
      <MessageBubble
        msg={{
          id: 1,
          role: "user",
          content: MESSAGE,
          ts: reply.ts,
          failed: true,
          failedNote: "Mila couldn't answer that. Your credit is back.",
        }}
        onRetry={() => {}}
        sending={false}
      />,
    );
    expect(html).toContain(asMarkup("Mila couldn't answer that. Your credit is back."));
    expect(html).not.toContain("Not sent.");
    expect(html).toMatch(/<button[^>]*class="[^"]*min-h-11[^"]*"[^>]*>.*?Try again/);
  });

  test("a plain failure still reads Not sent.", async () => {
    const html = await renderAppMarkup(
      <MessageBubble
        msg={{ id: 1, role: "user", content: MESSAGE, ts: reply.ts, failed: true }}
        onRetry={() => {}}
        sending={false}
      />,
    );
    expect(html).toContain("Not sent.");
  });

  test("a delivered turn gets a calm note, never a failure or a retry", async () => {
    const html = await renderAppMarkup(
      <MessageBubble
        msg={{
          id: 1,
          role: "user",
          content: MESSAGE,
          ts: reply.ts,
          note: CONCIERGE_COPY.delivered,
        }}
        onRetry={() => {}}
        sending={false}
      />,
    );
    expect(html).toContain(CONCIERGE_COPY.delivered);
    expect(html).not.toContain("Try again");
    expect(html).not.toContain('role="alert"');
  });
});

describe("copy", () => {
  test("no em or en dashes in the chat or the bubble", () => {
    // Built from code points, so this file holds no dash characters itself.
    const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
    expect(CHAT_SOURCE).not.toMatch(dashes);
    expect(BUBBLE_SOURCE).not.toMatch(dashes);
    for (const line of Object.values(CONCIERGE_COPY)) expect(line).not.toMatch(dashes);
  });
});
