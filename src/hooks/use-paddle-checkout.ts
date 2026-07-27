import { useCallback, useEffect, useState } from "react";
import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { queryKeys } from "@/constants/query-keys";
import { syncPaddlePurchase } from "@/lib/paddle-sync.functions";
import type { PublicSubscriptionPlan } from "@/lib/subscription-plans";

type CheckoutOpenOptions = Parameters<Paddle["Checkout"]["open"]>[0];
type PaddleEvent = { name?: string; data?: { transaction_id?: string } };

export function buildCheckoutOptions(
  plan: Pick<PublicSubscriptionPlan, "paddle_price_id">,
  user: { id: string; email?: string },
): CheckoutOpenOptions {
  return {
    items: [{ priceId: plan.paddle_price_id ?? "", quantity: 1 }],
    ...(user.email ? { customer: { email: user.email } } : {}),
    customData: { user_id: user.id },
    settings: { variant: "one-page" },
  };
}

let paddlePromise: Promise<Paddle | null> | null = null;
let activeEventHandler: ((event: PaddleEvent) => void) | null = null;

function getPaddle(): Promise<Paddle | null> {
  const token = import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined;
  const environment = import.meta.env.VITE_PADDLE_ENV as "sandbox" | "production" | undefined;
  if (!token || !environment) return Promise.resolve(null);
  if (!paddlePromise) {
    paddlePromise = initializePaddle({
      token,
      environment,
      eventCallback: (event) => activeEventHandler?.(event),
    }).then((p) => p ?? null);
  }
  return paddlePromise;
}

export function usePaddleCheckout(userId: string | undefined) {
  const [paddle, setPaddle] = useState<Paddle | null>(null);
  const queryClient = useQueryClient();
  const syncPurchase = useServerFn(syncPaddlePurchase);

  useEffect(() => {
    let cancelled = false;
    getPaddle().then((p) => {
      if (!cancelled) setPaddle(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function refresh() {
      queryClient.invalidateQueries({ queryKey: queryKeys.credits(userId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.mySubscription(userId) });
    }

    activeEventHandler = (event: PaddleEvent) => {
      if (event.name === "checkout.completed") {
        const transactionId = event.data?.transaction_id;
        const toastId = toast.loading("Payment received — activating your plan…");
        // Apply the purchase now instead of waiting on webhook delivery, then
        // dismiss the Paddle overlay so the user lands back in the app.
        (transactionId
          ? syncPurchase({ data: { transactionId } })
          : Promise.reject(new Error("no transaction id"))
        )
          .then(() => {
            refresh();
            void getPaddle().then((p) => p?.Checkout.close());
            toast.success("Your plan is active.", { id: toastId });
          })
          .catch(() => {
            // The webhook is still coming; refetch a couple of times for it.
            refresh();
            setTimeout(refresh, 5000);
            toast.success("Payment received — your plan will appear shortly.", { id: toastId });
          });
      }
      if (event.name === "checkout.error") {
        toast.error("Checkout couldn't load — try again in a moment.");
      }
    };
    return () => {
      activeEventHandler = null;
    };
  }, [queryClient, userId, syncPurchase]);

  const openCheckout = useCallback(
    (
      plan: Pick<PublicSubscriptionPlan, "paddle_price_id">,
      user: { id: string; email?: string },
    ) => {
      if (!paddle || !plan.paddle_price_id) return;
      paddle.Checkout.open(buildCheckoutOptions(plan, user));
    },
    [paddle],
  );

  return { openCheckout, ready: !!paddle };
}
