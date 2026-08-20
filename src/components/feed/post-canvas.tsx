import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import type { FeedPost } from "@/lib/posts.functions";
import type { PostItem } from "@/lib/outfit-items";
import { PostItemDrawer } from "@/components/feed/post-item-drawer";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { AvatarInitial } from "@/components/ui/avatar-initial";
import { relativeTime } from "@/lib/utils";

export function PostCanvas({ post }: { post: FeedPost }) {
  const author = post.is_self ? "You" : post.author_name?.trim() || "Member";
  const [openItem, setOpenItem] = useState<PostItem | null>(null);

  return (
    <article className="atelier-card overflow-hidden shadow-none">
      <header className="flex items-center px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <AvatarInitial name={author} className="size-9 shrink-0" />
          <div className="min-w-0">
            <span className="flex items-center gap-1">
              <span className="truncate text-sm font-medium text-ink">{author}</span>
              {post.author_verified && <VerifiedBadge />}
            </span>
            <p className="text-xs text-muted-foreground">{relativeTime(post.created_at)}</p>
          </div>
        </div>
      </header>

      <div className="relative aspect-3/4 w-full overflow-hidden bg-canvas">
        {post.image_url_back ? (
          <img
            src={post.image_url_back}
            alt={`${author}’s outfit`}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Image unavailable
          </div>
        )}

        {post.image_url_front && (
          <div className="absolute top-4 left-4 size-20 overflow-hidden rounded-full border-2 border-photo-edge shadow-paper md:h-24 md:w-24">
            <img
              src={post.image_url_front}
              alt={`${author}’s portrait`}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        )}

        {post.image_url_back &&
          post.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setOpenItem(item)}
              style={{
                left: `${(item.bbox.x + item.bbox.w / 2) * 100}%`,
                top: `${(item.bbox.y + item.bbox.h / 2) * 100}%`,
              }}
              className="atelier-focus-ring group absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full"
              aria-label={`Find pieces similar to ${item.label}`}
            >
              <span className="grid size-6 place-items-center rounded-full border-2 border-photo-edge bg-photo-scrim/40 backdrop-blur-sm transition-transform duration-200 ease-editorial group-hover:scale-105">
                <span className="size-4 rounded-full bg-photo-edge/90" />
              </span>
            </button>
          ))}
      </div>

      <PostItemDrawer item={openItem} onClose={() => setOpenItem(null)} />

      {(post.caption || post.generated_look_id) && (
        <footer className="space-y-2 px-5 py-4">
          {post.caption && (
            <p className="whitespace-pre-wrap font-serif text-base leading-relaxed text-ink">
              {post.caption}
            </p>
          )}
          {post.generated_look_id && (
            <Link
              to="/history"
              search={{ look: post.generated_look_id }}
              className="atelier-focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-control text-xs font-medium text-muted-foreground transition-colors hover:text-ink"
            >
              <Sparkles className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              View AI blueprint
            </Link>
          )}
        </footer>
      )}
    </article>
  );
}
