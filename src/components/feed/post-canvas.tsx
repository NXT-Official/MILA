import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import type { FeedPost } from "@/lib/posts.functions";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { AvatarInitial } from "@/components/ui/avatar-initial";
import { relativeTime } from "@/lib/utils";

export function PostCanvas({ post }: { post: FeedPost }) {
  const author = post.is_self ? "You" : post.author_name?.trim() || "Member";

  return (
    <article className="rounded-3xl atelier-glass shadow-atelier-soft overflow-hidden">
      <header className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <AvatarInitial name={author} className="size-9" />
          <div className="min-w-0">
            <span className="flex items-center gap-1">
              <Link
                to="/profile/$userId"
                params={{ userId: post.user_id }}
                className="font-serif text-sm text-ink truncate transition-colors hover:text-accent"
              >
                {author}
              </Link>
              {post.author_verified && <VerifiedBadge />}
            </span>
            <p className="text-nano uppercase tracking-label-xwide text-stone">
              {relativeTime(post.created_at)}
            </p>
          </div>
        </div>
        {post.is_self && (
          <span className="text-nano uppercase tracking-label-xwide text-stone px-2 py-0.5 rounded-full border border-porcelain/60">
            Today's OOTD
          </span>
        )}
      </header>

      <div className="relative w-full aspect-3/4 bg-atelier-ivory/60 overflow-hidden">
        {post.image_url_back ? (
          <img
            src={post.image_url_back}
            alt={`${author}'s outfit`}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-stone text-micro uppercase tracking-label-xwide">
            Image unavailable
          </div>
        )}

        {post.image_url_front && (
          <div className="absolute top-4 left-4 size-20 md:h-24 md:w-24 rounded-full overflow-hidden border-2 border-atelier-ivory shadow-atelier-float ring-1 ring-ink/10">
            <img
              src={post.image_url_front}
              alt={`${author}'s portrait`}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        )}
      </div>

      <footer className="px-5 py-4 space-y-3">
        {post.caption && (
          <p className="font-serif text-base leading-relaxed text-ink whitespace-pre-wrap">
            {post.caption}
          </p>
        )}
        {post.generated_look_id && (
          <Link
            to="/history"
            className="inline-flex items-center gap-1.5 text-micro uppercase tracking-label-xwide text-stone hover:text-ink transition-colors"
          >
            <Sparkles className="size-3" strokeWidth={1.75} />
            View AI Blueprint
          </Link>
        )}
      </footer>
    </article>
  );
}
