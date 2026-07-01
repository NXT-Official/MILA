import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Images } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/history")({
  component: History,
});

interface Outfit {
  id: string;
  image_url: string;
  match_score: number | null;
  created_at: string;
  analysis_result: unknown;
}

interface Analysis {
  color_match?: string;
  silhouette?: string;
  overall_score?: number;
  verdict?: string;
}

function History() {
  const { user } = useAuth();
  const [items, setItems] = useState<Outfit[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Outfit | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("outfits")
      .select("id,image_url,match_score,created_at,analysis_result")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setItems(data ?? []);
        setLoading(false);
      });
  }, [user]);

  const analysis = (selected?.analysis_result ?? null) as Analysis | null;

  return (
    <div className="atelier-page max-w-6xl">
      <header className="mb-8 sm:mb-12">
        <p className="atelier-kicker mb-3">History</p>
        <h1 className="atelier-title">Your archive.</h1>
        <p className="text-muted-foreground mt-3 max-w-xl">
          Every outfit you've analyzed, scored, and saved.
        </p>
      </header>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <div className="atelier-card p-10 sm:p-16 text-center">
          <Images className="h-8 w-8 mx-auto text-muted-foreground mb-4" strokeWidth={1.25} />
          <p className="font-serif text-2xl mb-2">No outfits yet</p>
          <p className="text-sm text-muted-foreground">Analyzed outfits will be collected here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {items.map((o) => (
            <button
              key={o.id}
              onClick={() => setSelected(o)}
              className="atelier-hairline-card aspect-[3/4] relative overflow-hidden text-left cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img src={o.image_url} alt="outfit" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-atelier-ink/0 group-hover:bg-atelier-ink/20 transition-colors" />
              <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-atelier-ink/70 to-transparent text-atelier-ivory">
                <p className="font-serif text-2xl">{o.match_score ?? "—"}</p>
                <p className="text-[10px] uppercase tracking-widest opacity-70">
                  {new Date(o.created_at).toLocaleDateString()}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-5 sm:p-6">
          <DialogHeader>
            <DialogTitle className="font-serif text-3xl">
              {analysis?.overall_score != null ? `Score ${analysis.overall_score}` : "Outfit"}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-6">
              <img src={selected.image_url} alt="outfit" className="w-full max-h-[50vh] object-contain bg-muted rounded-sm" />
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                {new Date(selected.created_at).toLocaleString()}
              </p>

              {analysis?.verdict && (
                <div className="bg-card border border-border p-6 rounded-sm">
                  <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-3">Stylist's Verdict</p>
                  <p className="font-serif text-xl leading-relaxed">{analysis.verdict}</p>
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-px bg-border">
                {analysis?.color_match && (
                  <div className="bg-card p-6">
                    <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-2">Color Match</p>
                    <p className="text-sm leading-relaxed">{analysis.color_match}</p>
                  </div>
                )}
                {analysis?.silhouette && (
                  <div className="bg-card p-6">
                    <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-2">Silhouette</p>
                    <p className="text-sm leading-relaxed">{analysis.silhouette}</p>
                  </div>
                )}
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mb-2">Raw analysis</p>
                <pre className="text-xs bg-muted p-4 rounded-sm overflow-x-auto font-mono">
{JSON.stringify(selected.analysis_result, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}