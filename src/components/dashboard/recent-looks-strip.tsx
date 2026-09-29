import { Link } from "@tanstack/react-router";
import { ImageOff, Images } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";
import { relativeTime } from "@/lib/utils";
import type { RecentLook } from "@/lib/queries/dashboard-stats";

interface RecentLooksStripProps {
  looks: RecentLook[] | undefined;
  loading: boolean;
}

export function RecentLooksStrip({ looks, loading }: RecentLooksStripProps) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-serif text-lg text-ink">Recent Looks</h2>
        <Link
          to="/history"
          className="text-micro uppercase tracking-label text-muted-foreground hover:text-ink transition-colors"
        >
          View all
        </Link>
      </div>

      {loading ? (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-24 shrink-0 rounded-control" />
          ))}
        </div>
      ) : !looks || looks.length === 0 ? (
        <EmptyState
          icon={<Images className="size-6" strokeWidth={1.5} />}
          title="No looks yet"
          description="Generate today's look to start building your history."
          className="py-8"
        />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {looks.map((look) => (
            <Link
              key={look.id}
              to="/history"
              search={{ look: look.id }}
              className="atelier-focus-ring group relative h-28 w-24 shrink-0 overflow-hidden rounded-control border border-porcelain/40"
            >
              <ImageWithFallback
                src={look.image_url}
                alt=""
                className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                fallback={
                  <div className="flex size-full items-center justify-center bg-accent-soft/40 text-muted-foreground">
                    <ImageOff className="size-5" strokeWidth={1.5} />
                  </div>
                }
              />
              <span className="absolute inset-x-0 bottom-0 bg-ink/60 px-1.5 py-1 text-nano text-surface backdrop-blur-sm">
                {relativeTime(look.created_at)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
