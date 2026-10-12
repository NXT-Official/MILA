import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  savedProductIds,
  savedProductsQueryOptions,
  type SaveableProduct,
} from "@/lib/queries/saved-products";
import { toggleSavedProduct, type SaveContext } from "@/lib/saved-product-toggle";
import { cn } from "@/lib/utils";

/**
 * Bookmark toggle for a recommended product, pinned top-right over its photo
 * (ProductCard's `actions` slot). Renders nothing for a signed-out viewer,
 * until the saved list has loaded, and while saved pieces are unavailable
 * (migration not applied), so it never shows a state it cannot keep.
 */
export function SaveProductButton({
  product,
  context,
  className,
}: {
  product: SaveableProduct;
  context: SaveContext;
  className?: string;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({ ...savedProductsQueryOptions(user?.id), enabled: !!user });
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  if (!user || data?.status !== "ready") return null;

  const saved = savedProductIds(data).has(product.id);
  const label = saved ? `Saved, remove ${product.title}` : `Save ${product.title}`;
  const Icon = saved ? BookmarkCheck : Bookmark;

  async function toggle() {
    if (!user || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const { outcome } = await toggleSavedProduct({
        client: supabase,
        queryClient,
        userId: user.id,
        product,
        context,
        currentlySaved: saved,
      });
      if (outcome === "saved") {
        toast.success("Saved. It will wait for you in Saved pieces.", {
          action: { label: "View", onClick: () => navigate({ to: "/saved" }) },
        });
      } else if (outcome === "unavailable") {
        toast.message("Saving pieces is not switched on yet.");
      } else if (outcome === "failed") {
        toast.error(
          saved
            ? "Couldn't remove that piece. Please try again."
            : "Couldn't save that piece. Please try again.",
        );
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      aria-label={label}
      aria-busy={busy || undefined}
      title={label}
      className={cn(
        "atelier-focus-ring inline-flex size-11 items-center justify-center rounded-full border shadow-paper backdrop-blur transition-[color,background-color,transform] duration-200 ease-editorial active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100",
        saved
          ? "border-transparent bg-ink/90 text-surface hover:bg-ink"
          : "border-line/70 bg-canvas/90 text-ink hover:bg-canvas",
        className,
      )}
    >
      <Icon className="size-4.5" strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
