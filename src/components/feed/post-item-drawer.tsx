import { ExternalLink } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { sourceUrlHost, type PostItem } from "@/lib/outfit-items";

/**
 * Opened by tapping a hotspot. Shows the piece, wherever the poster said it's
 * from, and visually similar items.
 */
export function PostItemDrawer({ item, onClose }: { item: PostItem | null; onClose: () => void }) {
  return (
    <Sheet open={!!item} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl border-t border-porcelain/60 px-6 pt-8 pb-10 max-h-[85vh] overflow-y-auto"
      >
        {item && (
          <div className="max-w-md mx-auto space-y-6">
            <SheetHeader className="text-center space-y-2">
              <p className="text-micro uppercase tracking-label-max text-muted-foreground">
                {item.category}
              </p>
              <SheetTitle className="font-serif text-3xl leading-tight">{item.label}</SheetTitle>
              <SheetDescription className="text-sm">
                {item.attributes.primary_color} · {item.attributes.silhouette_tags.join(" · ")}
              </SheetDescription>
            </SheetHeader>

            {item.source_url && (
              <a
                href={item.source_url}
                target="_blank"
                // nofollow because the destination is poster-supplied and unvetted.
                rel="noopener noreferrer nofollow"
                className="atelier-focus-ring flex items-center justify-between gap-3 rounded-2xl atelier-glass px-5 py-4"
              >
                <span className="min-w-0">
                  <span className="block text-nano uppercase tracking-label-xwide text-stone">
                    Poster's link
                  </span>
                  {/* The hostname, never the raw URL: a long path can otherwise be
                      dressed up to look like it points at another domain. */}
                  <span className="block font-serif text-base text-ink truncate">
                    {sourceUrlHost(item.source_url)}
                  </span>
                </span>
                <ExternalLink className="size-4 shrink-0 text-stone" strokeWidth={1.75} />
              </a>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
