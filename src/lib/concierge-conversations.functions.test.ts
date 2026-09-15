import { describe, expect, mock, test } from "bun:test";
import { renameConciergeConversationForUser } from "./concierge-conversations.functions";

type Terminal = { data: unknown; error: unknown };

function fakeChain(terminal: Terminal, onWrite?: (payload: unknown) => void) {
  const chain = {
    update: (payload: unknown) => {
      onWrite?.(payload);
      return chain;
    },
    eq: (..._args: unknown[]) => chain,
    then: (resolve: (v: Terminal) => void) => resolve(terminal),
  };
  return chain;
}

function fakeDb(terminal: Terminal, onWrite?: (payload: unknown) => void) {
  return {
    from: mock(() => fakeChain(terminal, onWrite)),
  } as unknown as Parameters<typeof renameConciergeConversationForUser>[0];
}

describe("renameConciergeConversationForUser", () => {
  test("updates the conversation title scoped to the owning user", async () => {
    const writes: unknown[] = [];
    const db = fakeDb({ data: null, error: null }, (p) => writes.push(p));

    const result = await renameConciergeConversationForUser(
      db,
      "user-1",
      "conversation-1",
      "New title",
    );

    expect(result).toEqual({ id: "conversation-1" });
    expect(writes).toEqual([{ title: "New title" }]);
    expect(db.from).toHaveBeenCalledWith("concierge_conversations");
  });

  test("throws when the update fails", async () => {
    const db = fakeDb({ data: null, error: { message: "row not found" } });

    await expect(
      renameConciergeConversationForUser(db, "user-1", "conversation-1", "New title"),
    ).rejects.toThrow("row not found");
  });
});
