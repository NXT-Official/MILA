import { useCallback, useEffect, useState } from "react";
import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/constants/query-keys";
import type { PublicSubscriptionPlan } from "@/lib/subscription-plans";

type CheckoutOpenOptions = Parameters<Paddle["Checkout"]["open"]>[0];
type PaddleEvent = { name?: string };

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
    activeEventHandler = (event: PaddleEvent) => {
      if (event.name === "checkout.completed") {
        toast.success("Payment received — activating your plan…");
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: queryKeys.credits(userId) });
        }, 4000);
      }
      if (event.name === "checkout.error") {
        toast.error("Checkout couldn't load — try again in a moment.");
      }
    };
    return () => {
      activeEventHandler = null;
    };
  }, [queryClient, userId]);

  const openCheckout = useCallback(
    (plan: Pick<PublicSubscriptionPlan, "paddle_price_id">, user: { id: string; email?: string }) => {
      if (!paddle || !plan.paddle_price_id) return;
      paddle.Checkout.open(buildCheckoutOptions(plan, user));
    },
    [paddle],
  );

  return { openCheckout, ready: !!paddle };
}
