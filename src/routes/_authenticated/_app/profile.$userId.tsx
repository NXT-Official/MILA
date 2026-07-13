import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, EyeOff, Images } from "lucide-react";
import { PostCanvas } from "@/components/feed/post-canvas";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryKeys } from "@/constants/query-keys";
import { getMemberProfile } from "@/lib/posts.functions";

export const Route = createFileRoute("/_authenticated/_app/profile/$userId")({
  component: MemberProfilePage,
});

function MemberProfilePage() {
  const { userId } = Route.useParams();
  const fetchProfile = useServerFn(getMemberProfile);
  const [tab, setTab] = useState<"feed" | "hidden">("feed");
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.memberProfile(userId),
    queryFn: () => fetchProfile({ data: { user_id: userId } }),
  });

  if (isLoading)
    return <div className="py-20 text-center text-sm text-stone">Loading profile…</div>;
  if (isError || !data) {
    return <div className="py-20 text-center font-serif text-xl text-ink">Profile not found.</div>;
  }

  const name = data.profile.full_name?.trim() || data.profile.username || "Member";
  const initial = name[0]?.toUpperCase() || "M";
  const visiblePosts = data.posts.filter((post) => !post.hidden);
  const hiddenPosts = data.posts.filter((post) => post.hidden);
  const activePosts = tab === "hidden" ? hiddenPosts : visiblePosts;

  return (
    <section className="mx-auto max-w-2xl space-y-7 px-4 py-10 md:px-6 md:py-14">
      <header className="relative overflow-hidden rounded-3xl border border-porcelain/60 bg-linear-to-br from-atelier-champagne/25 via-background to-porcelain/20 p-6 shadow-atelier-soft">
        <div className="relative flex items-center gap-5">
          <div className="flex size-20 shrink-0 items-center justify-center rounded-full border border-white/70 bg-background/70 font-serif text-3xl text-ink shadow-atelier-soft">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-serif text-3xl text-ink">{name}</h1>
            {data.profile.username && (
              <p className="mt-1 text-sm text-stone">@{data.profile.username}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.18em] text-ink">
              <span className="rounded-full border border-porcelain/70 bg-background/60 px-2.5 py-1">
                Season · {data.profile.color_season ?? "Unset"}
              </span>
              <span className="rounded-full border border-porcelain/70 bg-background/60 px-2.5 py-1">
                Face · {data.profile.face_shape ?? "—"}
              </span>
              <span className="rounded-full border border-porcelain/70 bg-background/60 px-2.5 py-1">
                Hair · {data.profile.hair_type ?? "—"}
              </span>
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-stone">
              <CalendarDays className="size-3" aria-hidden="true" />
              Joined {new Date(data.profile.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(value) => setTab(value as "feed" | "hidden")}>
        <TabsList className="h-10">
          <TabsTrigger value="feed" className="gap-1.5 text-xs uppercase tracking-[0.18em]">
            <Images className="size-3.5" aria-hidden="true" /> Feed ({visiblePosts.length})
          </TabsTrigger>
          {data.can_view_hidden && (
            <TabsTrigger value="hidden" className="gap-1.5 text-xs uppercase tracking-[0.18em]">
              <EyeOff className="size-3.5" aria-hidden="true" /> Hidden Feed ({hiddenPosts.length})
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>

      {activePosts.length ? (
        <div className="space-y-6">
          {activePosts.map((post) => (
            <div key={post.id} className="space-y-3">
              {post.hidden && (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3">
                  <p className="text-[9px] uppercase tracking-[0.22em] text-destructive">
                    Hidden post
                  </p>
                  <p className="mt-1 text-sm text-stone">
                    Reason: {post.hidden_reason?.trim() || "No reason was provided."}
                  </p>
                </div>
              )}
              <PostCanvas post={post} />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-porcelain/70 p-10 text-center text-sm text-stone">
          {tab === "hidden" ? "No hidden posts." : "No visible posts yet."}
        </div>
      )}
    </section>
  );
}
