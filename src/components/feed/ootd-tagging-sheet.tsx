import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2, Trash2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { queryKeys } from "@/constants/query-keys";
import { updatePostItems } from "@/lib/outfit-items.functions";
import { normalizeSourceUrl, type PostItem } from "@/lib/outfit-items";
import { errorMessage } from "@/lib/utils";

type Draft = { id: string; category: string; label: string; sourceUrl: string };

/**
 * Shown once, right after publishing. Everything here is optional — the post is
 * already live, so closing this sheet simply keeps Mila's own labels.
 */
export function OotdTaggingSheet({
  postId,
  items,
  userId,
  open,
  onOpenChange,
}: {
  postId: string;
  items: PostItem[];
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    items.map((item) => ({
      id: item.id,
      category: item.category,
      label: item.label,
      sourceUrl: item.source_url ?? "",
    })),
  );
  const [saving, setSaving] = useState(false);
  const save = useServerFn(updatePostItems);
  const queryClient = useQueryClient();

  function edit(id: string, patch: Partial<Draft>) {
    setDrafts((current) => current.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  const invalidLink = drafts.find((d) => d.sourceUrl.trim() && !normalizeSourceUrl(d.sourceUrl));
  const emptyLabel = drafts.some((d) => !d.label.trim());

  async function handleSave() {
    setSaving(true);
    try {
      await save({
        data: {
          post_id: postId,
          items: drafts.map((d) => ({
            id: d.id,
            label: d.label.trim(),
            source_url: d.sourceUrl.trim() || null,
          })),
        },
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.feed(userId) });
      toast.success(drafts.length ? "Your pieces are tagged." : "Tags cleared.");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't save your tags."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl border-t border-porcelain/60 px-6 pt-8 pb-10 max-h-[92vh] overflow-y-auto"
      >
        <SheetHeader className="text-center space-y-2 mb-6">
          <p className="text-micro uppercase tracking-label-max text-muted-foreground">
            Tag Your Pieces
          </p>
          <SheetTitle className="font-serif text-3xl leading-tight">
            Mila spotted {drafts.length} {drafts.length === 1 ? "piece" : "pieces"}
          </SheetTitle>
          <SheetDescription className="max-w-md mx-auto text-sm">
            Fix a name, drop the link where it's from, or skip entirely — your look is already
            posted.
          </SheetDescription>
        </SheetHeader>

        <div className="max-w-md mx-auto space-y-4">
          {drafts.map((draft) => (
            <div key={draft.id} className="rounded-2xl atelier-glass p-4 space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-nano uppercase tracking-label-xwide text-stone px-2 py-0.5 rounded-full border border-porcelain/60 shrink-0">
                  {draft.category}
                </span>
                <Input
                  value={draft.label}
                  onChange={(e) => edit(draft.id, { label: e.target.value })}
                  maxLength={100}
                  aria-label="Piece name"
                  className="h-9 flex-1"
                />
                <button
                  type="button"
                  onClick={() => setDrafts((c) => c.filter((d) => d.id !== draft.id))}
                  className="atelier-focus-ring shrink-0 size-9 rounded-full border border-porcelain/60 text-stone hover:text-ink flex items-center justify-center"
                  aria-label={`Remove ${draft.label || "this piece"}`}
                >
                  <Trash2 className="size-4" strokeWidth={1.75} />
                </button>
              </div>
              <Input
                value={draft.sourceUrl}
                onChange={(e) => edit(draft.id, { sourceUrl: e.target.value })}
                type="url"
                inputMode="url"
                leadingIcon={Link2}
                placeholder="https://where-it's-from.com"
                aria-label="Where this piece is from"
                className="h-9"
              />
            </div>
          ))}

          {drafts.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-6">
              No pieces left to tag. Saving removes every tag from this look.
            </p>
          )}

          {invalidLink && (
            <p className="text-xs text-destructive text-center">
              Links must start with https:// — check “{invalidLink.label}”.
            </p>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="atelier-label"
            >
              Skip
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              loading={saving}
              disabled={!!invalidLink || emptyLabel}
              className="flex-1 h-12 rounded-full text-micro uppercase tracking-label-xwide"
            >
              {saving ? "Saving…" : "Save tags"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
