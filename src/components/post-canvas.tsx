import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import type { FeedPost } from "@/lib/posts.functions";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function PostCanvas({ post }: { post: FeedPost }) {
  const author = post.is_self ? "You" : post.author_name?.trim() || "Member";
  const initial = (author[0] || "M").toUpperCase();

  return (
    <article className="rounded-3xl border border-porcelain/60 bg-background/70 backdrop-blur-xl shadow-atelier-soft overflow-hidden">
      <header className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full border border-porcelain/60 bg-gradient-to-br from-atelier-champagne/30 to-porcelain/20 flex items-center justify-center font-serif text-sm text-ink">
            {initial}
          </div>
          <div className="min-w-0">
            <p className="font-serif text-sm text-ink truncate">{author}</p>
            <p className="text-[9px] uppercase tracking-[0.3em] text-stone">
              {relativeTime(post.created_at)}
            </p>
          </div>
        </div>
        {post.is_self && (
          <span className="text-[9px] uppercase tracking-[0.32em] text-stone px-2 py-0.5 rounded-full border border-porcelain/60">
            Today's OOTD
          </span>
        )}
      </header>

      <div className="relative w-full aspect-[3/4] bg-atelier-ivory/60 overflow-hidden">
        {post.image_url_back ? (
          <img
            src={post.image_url_back}
            alt={`${author}'s outfit`}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-stone text-[10px] uppercase tracking-[0.3em]">
            Image unavailable
          </div>
        )}

        {/* Front-camera portrait — top-left circular hairline */}
        {post.image_url_front && (
          <div className="absolute top-4 left-4 h-20 w-20 md:h-24 md:w-24 rounded-full overflow-hidden border-2 border-atelier-ivory shadow-atelier-float ring-1 ring-ink/10">
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
            className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.28em] text-stone hover:text-ink transition-colors"
          >
            <Sparkles className="h-3 w-3" strokeWidth={1.5} />
            View AI Blueprint
          </Link>
        )}
      </footer>
    </article>
  );
}