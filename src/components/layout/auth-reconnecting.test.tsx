import { describe, expect, test } from "bun:test";
import { runReconnectRetry } from "@/hooks/use-auth-connection";

describe("AuthReconnecting Try again (R-4)", () => {
  test("forces a fresh session refresh before re-running the page's own read", () => {
    const calls: string[] = [];
    runReconnectRetry({ refreshNow: () => calls.push("refreshNow") }, () => calls.push("onRetry"));
    expect(calls).toEqual(["refreshNow", "onRetry"]);
  });
});
