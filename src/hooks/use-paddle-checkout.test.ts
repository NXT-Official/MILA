import { describe, expect, test } from "bun:test";
import { buildCheckoutOptions } from "./use-paddle-checkout";

describe("buildCheckoutOptions", () => {
  test("wires the plan's price id and the user's id into custom_data", () => {
    const options = buildCheckoutOptions(
      { paddle_price_id: "pri_01abc" },
      { id: "user-1", email: "jane@example.com" },
    );

    expect(options.items).toEqual([{ priceId: "pri_01abc", quantity: 1 }]);
    expect(options.customData).toEqual({ user_id: "user-1" });
    expect(options.customer).toEqual({ email: "jane@example.com" });
  });

  test("omits customer prefill when the user has no email", () => {
    const options = buildCheckoutOptions({ paddle_price_id: "pri_01abc" }, { id: "user-1" });

    expect(options.customer).toBeUndefined();
  });

  test("falls back to an empty price id when the plan has none set", () => {
    const options = buildCheckoutOptions({ paddle_price_id: null }, { id: "user-1" });

    expect(options.items).toEqual([{ priceId: "", quantity: 1 }]);
  });
});
