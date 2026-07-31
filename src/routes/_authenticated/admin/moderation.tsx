import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EyeOff, Eye, Trash2, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { queryKeys } from "@/constants/query-keys";
import { adminHidePost, adminDeletePost } from "@/lib/admin.functions";
import { adminModerationQueryOptions } from "@/lib/queries/admin";
import { requireStaffRoutePermission } from "@/lib/staff-route";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/moderation")({
  beforeLoad: ({ context }) => requireStaffRoutePermission(context.queryClient, "moderation.view"),
  component: ModerationPage,
});

function ModerationPage() {
  const qc = useQueryClient();
  const hide = useServerFn(adminHidePost);
  const del = useServerFn(adminDeletePost);
  const [tab, setTab] = useState<"feed" | "hidden">("feed");

  const { data, isLoading } = useQuery(adminModerationQueryOptions());

  async function toggleHidden(id: string, hidden: boolean) {
    try {
      const reason = hidden ? (window.prompt("Reason for hiding (optional):") ?? null) : null;
      await hide({ data: { post_id: id, hidden, reason } });
      toast.success(hidden ? "Post hidden from feed." : "Post restored.");
      qc.invalidateQueries({ queryKey: queryKeys.adminPosts });
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't update post."));
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this post permanently? This cannot be undone.")) return;
    try {
      await del({ data: { post_id: id } });
      toast.success("Post deleted.");
      qc.invalidateQueries({ queryKey: queryKeys.adminPosts });
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't delete."));
    }
  }

  const rows = data ?? [];
  const visibleRows = rows.filter((post) => !post.hidden);
  const hiddenRows = rows.filter((post) => post.hidden);
  const activeRows = tab === "hidden" ? hiddenRows : visibleRows;

  return (
    <div>
      <Tabs value={tab} onValueChange={(value) => setTab(value as "feed" | "hidden")}>
        <TabsList className="mb-6 h-10">
          <TabsTrigger value="feed" className="text-xs uppercase tracking-label">
            Feed ({visibleRows.length})
          </TabsTrigger>
          <TabsTrigger value="hidden" className="text-xs uppercase tracking-label">
            Hidden Feed ({hiddenRows.length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mb-6 atelier-label">
        {isLoading ? "Loading…" : `${activeRows.length} entries`}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {activeRows.map((p) => (
          <article
            key={p.id}
            className="rounded-panel border border-porcelain/60 bg-atelier-panel/40 overflow-hidden flex flex-col"
          >
            <div className="relative aspect-3/4 bg-background">
              {p.image_url_back ? (
                <img
                  src={p.image_url_back}
                  alt=""
                  className={`w-full h-full object-cover ${p.hidden ? "opacity-40 grayscale" : ""}`}
                />
              ) : null}
              {p.hidden && (
                <div className="absolute top-3 left-3">
                  <Badge className="bg-background/90 border-destructive/50 text-destructive text-nano uppercase tracking-label">
                    Hidden
                  </Badge>
                </div>
              )}
            </div>
            <div className="p-4 flex-1 flex flex-col gap-3">
              <div>
                <Link
                  to="/profile/$userId"
                  params={{ userId: p.user_id }}
                  className="block truncate font-serif text-sm text-ink transition-colors hover:text-accent"
                >
                  {p.author_name || "Unnamed"}
                </Link>
                <div className="text-micro uppercase tracking-label text-stone truncate">
                  {p.author_email}
                </div>
              </div>
              {p.caption && (
                <p className="text-xs text-stone line-clamp-3 leading-relaxed">{p.caption}</p>
              )}
              {p.hidden && (
                <p className="text-micro uppercase tracking-label text-destructive/80">
                  Reason: {p.hidden_reason?.trim() || "No reason was provided."}
                </p>
              )}
              <div className="mt-auto flex items-center gap-2 pt-2 border-t border-porcelain/30">
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1 h-8 atelier-label hover:text-ink"
                  onClick={() => toggleHidden(p.id, !p.hidden)}
                >
                  {p.hidden ? (
                    <>
                      <Eye className="size-4 mr-1.5" strokeWidth={1.75} aria-hidden="true" />
                      Restore
                    </>
                  ) : (
                    <>
                      <EyeOff className="size-4 mr-1.5" strokeWidth={1.75} aria-hidden="true" />
                      Hide
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-3 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => remove(p.id)}
                  aria-label={`Delete post by ${p.author_name || "member"}`}
                  title="Delete"
                >
                  <Trash2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!isLoading && activeRows.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-5 py-16 text-center text-sm text-stone border border-porcelain/30 rounded-panel">
          <Inbox className="size-6 text-muted" strokeWidth={1.75} aria-hidden="true" />
          {tab === "hidden" ? "No hidden posts." : "No visible posts."}
        </div>
      )}
    </div>
  );
}
