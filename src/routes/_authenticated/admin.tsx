import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldAlert, EyeOff, Eye, Trash2, UserX, UserCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import {
  adminListUsers,
  adminSetAdminRole,
  adminSetSuspended,
  adminListPosts,
  adminHidePost,
  adminDeletePost,
  adminAmIAdmin,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
});

function AdminPage() {
  const checkAdmin = useServerFn(adminAmIAdmin);
  const { data: gate, isLoading } = useQuery({
    queryKey: ["isAdmin:gate"],
    queryFn: () => checkAdmin(),
  });

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-stone">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (!gate?.is_admin) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-24 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-stone" strokeWidth={1.2} />
        <h1 className="mt-6 font-serif text-2xl tracking-[0.2em] uppercase text-ink">
          Restricted
        </h1>
        <p className="mt-3 text-sm text-stone">
          The Atelier admin suite is reserved for authorized stewards.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-5 md:px-8 py-10 md:py-14">
      <header className="mb-10">
        <div className="text-[10px] uppercase tracking-[0.32em] text-stone">Atelier · Steward</div>
        <h1 className="mt-2 font-serif text-3xl md:text-4xl tracking-[0.18em] uppercase text-ink">
          Admin Suite
        </h1>
        <p className="mt-3 text-sm text-stone max-w-xl">
          Manage members, grant stewardship, and moderate the community feed.
        </p>
      </header>

      <Tabs defaultValue="users" className="w-full">
        <TabsList className="bg-transparent border border-porcelain/60 rounded-full p-1 h-auto">
          <TabsTrigger
            value="users"
            className="rounded-full text-[10px] uppercase tracking-[0.22em] px-5 py-2 data-[state=active]:bg-ink data-[state=active]:text-background"
          >
            Members
          </TabsTrigger>
          <TabsTrigger
            value="posts"
            className="rounded-full text-[10px] uppercase tracking-[0.22em] px-5 py-2 data-[state=active]:bg-ink data-[state=active]:text-background"
          >
            Moderation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-8">
          <UsersPanel />
        </TabsContent>
        <TabsContent value="posts" className="mt-8">
          <ModerationPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function UsersPanel() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const list = useServerFn(adminListUsers);
  const setRole = useServerFn(adminSetAdminRole);
  const setSuspended = useServerFn(adminSetSuspended);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin:users"],
    queryFn: () => list(),
  });

  const rows = (data ?? []).filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.email?.toLowerCase().includes(q) ||
      u.full_name?.toLowerCase().includes(q) ||
      u.username?.toLowerCase().includes(q)
    );
  });

  async function toggleAdmin(id: string, grant: boolean) {
    try {
      await setRole({ data: { user_id: id, grant } });
      toast.success(grant ? "Steward role granted." : "Steward role revoked.");
      qc.invalidateQueries({ queryKey: ["admin:users"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update role.");
    }
  }

  async function toggleSuspended(id: string, suspended: boolean) {
    try {
      await setSuspended({ data: { user_id: id, suspended } });
      toast.success(suspended ? "Member suspended." : "Member reinstated.");
      qc.invalidateQueries({ queryKey: ["admin:users"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update status.");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, username, or email"
          className="max-w-sm bg-background border-porcelain/60 rounded-full text-sm"
        />
        <div className="text-[10px] uppercase tracking-[0.22em] text-stone">
          {isLoading ? "Loading…" : `${rows.length} members`}
        </div>
      </div>

      <div className="rounded-2xl border border-porcelain/60 bg-atelier-panel/40 overflow-hidden">
        <div className="grid grid-cols-12 px-5 py-3 text-[9px] uppercase tracking-[0.22em] text-stone border-b border-porcelain/40">
          <div className="col-span-4">Member</div>
          <div className="col-span-3">Email</div>
          <div className="col-span-1 text-center">Credits</div>
          <div className="col-span-2 text-center">Steward</div>
          <div className="col-span-2 text-right">Status</div>
        </div>
        {rows.map((u) => (
          <div
            key={u.id}
            className="grid grid-cols-12 items-center px-5 py-4 border-b border-porcelain/30 last:border-0 hover:bg-background/40 transition-colors"
          >
            <div className="col-span-4 min-w-0">
              <div className="font-serif text-sm text-ink truncate">
                {u.full_name || u.username || "Unnamed"}
              </div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-stone mt-0.5">
                {u.username ? `@${u.username}` : "—"}
              </div>
            </div>
            <div className="col-span-3 text-xs text-stone truncate">{u.email}</div>
            <div className="col-span-1 text-center text-sm text-ink">{u.ai_credits}</div>
            <div className="col-span-2 flex justify-center">
              <Switch
                checked={u.is_admin}
                disabled={u.id === user?.id && u.is_admin}
                onCheckedChange={(v) => toggleAdmin(u.id, v)}
              />
            </div>
            <div className="col-span-2 flex justify-end items-center gap-2">
              {u.suspended ? (
                <Badge variant="outline" className="border-destructive/50 text-destructive text-[9px] uppercase tracking-[0.18em]">
                  Suspended
                </Badge>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-stone hover:text-ink"
                onClick={() => toggleSuspended(u.id, !u.suspended)}
                title={u.suspended ? "Reinstate" : "Suspend"}
              >
                {u.suspended ? <UserCheck className="h-4 w-4" /> : <UserX className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        ))}
        {!isLoading && rows.length === 0 && (
          <div className="px-5 py-10 text-center text-sm text-stone">No members found.</div>
        )}
      </div>
    </div>
  );
}

function ModerationPanel() {
  const qc = useQueryClient();
  const list = useServerFn(adminListPosts);
  const hide = useServerFn(adminHidePost);
  const del = useServerFn(adminDeletePost);

  const { data, isLoading } = useQuery({
    queryKey: ["admin:posts"],
    queryFn: () => list(),
  });

  async function toggleHidden(id: string, hidden: boolean) {
    try {
      const reason = hidden ? window.prompt("Reason for hiding (optional):") ?? null : null;
      await hide({ data: { post_id: id, hidden, reason } });
      toast.success(hidden ? "Post hidden from feed." : "Post restored.");
      qc.invalidateQueries({ queryKey: ["admin:posts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update post.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this post permanently? This cannot be undone.")) return;
    try {
      await del({ data: { post_id: id } });
      toast.success("Post deleted.");
      qc.invalidateQueries({ queryKey: ["admin:posts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete.");
    }
  }

  const rows = data ?? [];

  return (
    <div>
      <div className="mb-6 text-[10px] uppercase tracking-[0.22em] text-stone">
        {isLoading ? "Loading…" : `${rows.length} entries`}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {rows.map((p) => (
          <article
            key={p.id}
            className="rounded-2xl border border-porcelain/60 bg-atelier-panel/40 overflow-hidden flex flex-col"
          >
            <div className="relative aspect-[3/4] bg-background">
              {p.image_url_back ? (
                <img
                  src={p.image_url_back}
                  alt=""
                  className={`w-full h-full object-cover ${p.hidden ? "opacity-40 grayscale" : ""}`}
                />
              ) : null}
              {p.hidden && (
                <div className="absolute top-3 left-3">
                  <Badge variant="outline" className="bg-background/90 border-destructive/50 text-destructive text-[9px] uppercase tracking-[0.18em]">
                    Hidden
                  </Badge>
                </div>
              )}
            </div>
            <div className="p-4 flex-1 flex flex-col gap-3">
              <div>
                <div className="font-serif text-sm text-ink truncate">
                  {p.author_name || "Unnamed"}
                </div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-stone truncate">
                  {p.author_email}
                </div>
              </div>
              {p.caption && (
                <p className="text-xs text-stone line-clamp-3 leading-relaxed">{p.caption}</p>
              )}
              {p.hidden_reason && (
                <p className="text-[10px] uppercase tracking-[0.18em] text-destructive/80">
                  Reason: {p.hidden_reason}
                </p>
              )}
              <div className="mt-auto flex items-center gap-2 pt-2 border-t border-porcelain/40">
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1 h-8 text-[10px] uppercase tracking-[0.22em] text-stone hover:text-ink"
                  onClick={() => toggleHidden(p.id, !p.hidden)}
                >
                  {p.hidden ? (
                    <>
                      <Eye className="h-3.5 w-3.5 mr-1.5" />
                      Restore
                    </>
                  ) : (
                    <>
                      <EyeOff className="h-3.5 w-3.5 mr-1.5" />
                      Hide
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-3 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => remove(p.id)}
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!isLoading && rows.length === 0 && (
        <div className="px-5 py-16 text-center text-sm text-stone border border-porcelain/40 rounded-2xl">
          No posts to moderate.
        </div>
      )}
    </div>
  );
}