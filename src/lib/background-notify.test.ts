import { describe, expect, test } from "bun:test";
import { shouldNotifyInBackground } from "./background-notify";

describe("shouldNotifyInBackground", () => {
  test("true only when supported, hidden, and granted all hold", () => {
    expect(
      shouldNotifyInBackground({
        documentHidden: true,
        notificationSupported: true,
        permission: "granted",
      }),
    ).toBe(true);
  });

  test("false when the tab is foregrounded — the existing toast covers that case", () => {
    expect(
      shouldNotifyInBackground({
        documentHidden: false,
        notificationSupported: true,
        permission: "granted",
      }),
    ).toBe(false);
  });

  test("false when permission was never granted", () => {
    expect(
      shouldNotifyInBackground({
        documentHidden: true,
        notificationSupported: true,
        permission: "default",
      }),
    ).toBe(false);
    expect(
      shouldNotifyInBackground({
        documentHidden: true,
        notificationSupported: true,
        permission: "denied",
      }),
    ).toBe(false);
  });

  test("false when the Notification API isn't supported", () => {
    expect(
      shouldNotifyInBackground({
        documentHidden: true,
        notificationSupported: false,
        permission: "granted",
      }),
    ).toBe(false);
  });
});
