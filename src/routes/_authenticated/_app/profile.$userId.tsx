import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, EyeOff, Images, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PostCanvas } from "@/components/feed/post-canvas";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/constants/query-keys";
import { deletePost, getMemberProfile, updatePostCaption } from "@/lib/posts.functions";
import { errorMessage } from "@/lib/utils";
import { AvatarInitial } from "@/components/ui/avatar-initial";

export const Route = createFileRoute("/_authenticated/_app/profile/$userId")({
  component: MemberProfilePage,
});

function MemberProfilePage() {
  const { userId } = Route.useParams();
  const fetchProfile = useServerFn(getMemberProfile);
  const saveCaption = useServerFn(updatePostCaption);
  const removePost = useServerFn(deletePost);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"feed" | "hidden">("feed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.memberProfile(userId),
    queryFn: () => fetchProfile({ data: { user_id: userId } }),
  });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.memberProfile(userId) }),
      queryClient.invalidateQueries({ queryKey: ["feed"] }),
    ]);
  }

  async function handleSaveCaption(postId: string) {
    setBusy(true);
    try {
      await saveCaption({ data: { post_id: postId, caption: draft.trim() || null } });
      setEditingId(null);
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't save the caption."));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(postId: string) {
    if (!window.confirm("Delete this post? This can't be undone.")) return;
    setBusy(true);
    try {
      await removePost({ data: { post_id: postId } });
      toast.success("Post deleted.");
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't delete the post."));
    } finally {
      setBusy(false);
    }
  }

  if (isLoading)
    return <div className="py-20 text-center text-sm text-stone">Loading profile…</div>;
  if (isError || !data) {
    return <div className="py-20 text-center font-serif text-xl text-ink">Profile not found.</div>;
  }

  const name = data.profile.full_name?.trim() || data.profile.username || "Member";
  const visiblePosts = data.posts.filter((post) => !post.hidden);
  const hiddenPosts = data.posts.filter((post) => post.hidden);
  const activePosts = tab === "hidden" ? hiddenPosts : visiblePosts;

  return (
    <section className="mx-auto max-w-2xl space-y-7 px-4 py-10 md:px-6 md:py-14">
      <header className="relative overflow-hidden rounded-3xl border border-porcelain/60 bg-linear-to-br from-atelier-champagne/25 via-background to-porcelain/20 p-6 shadow-atelier-soft">
        <div className="relative flex items-center gap-5">
          <AvatarInitial
            name={name}
            className="flex size-20 shrink-0 items-center justify-center rounded-full border border-white/70 bg-background/70 font-serif text-3xl text-ink shadow-atelier-soft"
          />
          <div className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <h1 className="truncate font-serif text-3xl text-ink">{name}</h1>
              {data.profile.verified && <VerifiedBadge className="size-5" />}
            </span>
            {data.profile.username && (
              <p className="mt-1 text-sm text-stone">@{data.profile.username}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-nano uppercase tracking-label text-ink">
              {(
                [
                  ["Season", data.profile.color_season ?? "Unset"],
                  ["Face", data.profile.face_shape ?? "—"],
                  ["Hair", data.profile.hair_type ?? "—"],
                ] as const
              ).map(([label, value]) => (
                <span
                  key={label}
                  className="rounded-full border border-porcelain/60 bg-background/60 px-2.5 py-1"
                >
                  {label} · {value}
                </span>
              ))}
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-nano uppercase tracking-label text-stone">
              <CalendarDays className="size-3" aria-hidden="true" />
              Joined {new Date(data.profile.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(value) => setTab(value as "feed" | "hidden")}>
        <TabsList className="h-10">
          <TabsTrigger value="feed" className="gap-1.5 text-xs uppercase tracking-label">
            <Images className="size-3.5" aria-hidden="true" /> Feed ({visiblePosts.length})
          </TabsTrigger>
          {data.can_view_hidden && (
            <TabsTrigger value="hidden" className="gap-1.5 text-xs uppercase tracking-label">
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
                  <p className="text-nano uppercase tracking-label-wide text-destructive">
                    Hidden post
                  </p>
                  <p className="mt-1 text-sm text-stone">
                    Reason: {post.hidden_reason?.trim() || "No reason was provided."}
                  </p>
                </div>
              )}
              <PostCanvas post={post} />

              {post.is_self &&
                (editingId === post.id ? (
                  <div className="space-y-2">
                    <Textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      maxLength={500}
                      rows={3}
                      placeholder="Caption…"
                    />
                    <div className="flex justify-end gap-4 text-micro uppercase tracking-label-xwide">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        disabled={busy}
                        className="text-stone transition-colors hover:text-ink disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveCaption(post.id)}
                        disabled={busy}
                        className="text-ink transition-colors hover:text-accent disabled:opacity-50"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-end gap-4 text-micro uppercase tracking-label-xwide">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(post.id);
                        setDraft(post.caption ?? "");
                      }}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 text-stone transition-colors hover:text-ink disabled:opacity-50"
                    >
                      <Pencil className="size-3" strokeWidth={1.75} aria-hidden="true" />
                      Edit caption
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(post.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 text-destructive transition-colors hover:text-destructive/80 disabled:opacity-50"
                    >
                      <Trash2 className="size-3" strokeWidth={1.75} aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-porcelain/60 p-10 text-center text-sm text-stone">
          {tab === "hidden" ? "No hidden posts." : "No visible posts yet."}
        </div>
      )}
    </section>
  );
}
