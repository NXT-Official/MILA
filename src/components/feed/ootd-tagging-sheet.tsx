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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { queryKeys } from "@/constants/query-keys";
import { updatePostItems } from "@/lib/outfit-items.functions";
import { normalizeSourceUrl, type PostItem } from "@/lib/outfit-items";
import { errorMessage } from "@/lib/utils";

type Draft = { id: string; category: string; label: string; sourceUrl: string };

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
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto pt-8 pb-10">
        <SheetHeader className="mb-6 space-y-2 text-center">
          <SheetTitle className="font-serif text-2xl leading-snug">
            Mila spotted {drafts.length} {drafts.length === 1 ? "piece" : "pieces"}
          </SheetTitle>
          <SheetDescription className="max-w-md mx-auto text-sm">
            Fix a name, drop the link where it’s from, or skip entirely — your look is already
            posted.
          </SheetDescription>
        </SheetHeader>

        <div className="max-w-md mx-auto space-y-4">
          {drafts.map((draft) => (
            <div
              key={draft.id}
              className="space-y-3 rounded-panel border border-line bg-canvas p-4"
            >
              {/* Category and remove share the top row so the name gets full width;
                  on a phone the three-up row truncated every piece name. */}
              <div className="flex items-center justify-between gap-3">
                <Badge className="shrink-0">{draft.category}</Badge>
                <button
                  type="button"
                  onClick={() => setDrafts((c) => c.filter((d) => d.id !== draft.id))}
                  className="atelier-focus-ring -my-1 flex size-11 shrink-0 items-center justify-center rounded-full border border-line text-muted-foreground transition-colors hover:bg-accent-soft/40 hover:text-ink"
                  aria-label={`Remove ${draft.label || "this piece"}`}
                >
                  <Trash2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
                </button>
              </div>
              <Input
                value={draft.label}
                onChange={(e) => edit(draft.id, { label: e.target.value })}
                maxLength={100}
                aria-label="Piece name"
              />
              <Input
                value={draft.sourceUrl}
                onChange={(e) => edit(draft.id, { sourceUrl: e.target.value })}
                type="url"
                inputMode="url"
                leadingIcon={Link2}
                placeholder="https://example.com/the-piece"
                aria-label="Where this piece is from"
              />
            </div>
          ))}

          {drafts.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-6">
              No pieces left to tag. Saving removes every tag from this look.
            </p>
          )}

          {emptyLabel && (
            <p className="text-center text-xs text-destructive">
              Every piece needs a name before you can save.
            </p>
          )}

          {invalidLink && (
            <p className="text-center text-xs text-destructive">
              Links must start with https:// — check “{invalidLink.label}”.
            </p>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Skip
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              loading={saving}
              disabled={!!invalidLink || emptyLabel}
              size="lg"
              className="flex-1"
            >
              {saving ? "Saving…" : "Save tags"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
