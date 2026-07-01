import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Link } from "@tanstack/react-router";
import { Archive, AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

interface StudioMembershipDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  user: {
    fullName: string;
    username: string;
    season: string | null;
    faceShape: string | null;
    hairType: string | null;
  };
  onAcquirePasses?: () => void;
  onWatchEditorial?: () => void;
}

export function StudioMembershipDrawer({
  isOpen,
  onClose,
  user,
  onAcquirePasses,
  onWatchEditorial,
}: StudioMembershipDrawerProps) {
  const [view, setView] = useState<"membership" | "preferences">("membership");
  const { signOut } = useAuth();

  const missing = [
    !user.season && "Color Season",
    !user.faceShape && "Face Shape",
    !user.hairType && "Hair Type",
  ].filter(Boolean) as string[];

  return (
    <Sheet open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md p-0 flex flex-col bg-background"
      >
        {/* Header */}
        <SheetHeader className="px-6 pt-8 pb-5 border-b border-porcelain/40 flex flex-row items-end justify-between space-y-0">
          <div className="space-y-1 text-left">
            <SheetTitle className="font-serif text-2xl text-ink tracking-wide">
              {view === "membership" ? "Your Atelier" : "Preferences"}
            </SheetTitle>
            <SheetDescription className="text-[10px] uppercase tracking-[0.25em] text-stone">
              {view === "membership" ? "Client Dossier & Passes" : "Account Configuration"}
            </SheetDescription>
          </div>

          <button
            onClick={() => setView(view === "membership" ? "preferences" : "membership")}
            className="text-[10px] uppercase tracking-[0.15em] text-stone hover:text-ink transition-colors underline underline-offset-4 pb-1"
          >
            {view === "membership" ? "Settings" : "Back to Profile"}
          </button>
        </SheetHeader>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-8">
          {view === "membership" ? (
            <div className="space-y-8">
              {/* Identity */}
              <div className="text-center space-y-1.5 pb-6 border-b border-porcelain/30">
                <p className="font-serif text-xl text-ink">{user.fullName}</p>
                <p className="text-xs text-stone">@{user.username}</p>
                <p className="text-[10px] uppercase tracking-[0.25em] text-stone pt-2">
                  Prevailing Season:{" "}
                  <span className="text-ink font-semibold">{user.season ?? "Unset"}</span>
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-3 text-[10px] uppercase tracking-[0.2em]">
                  <span className={`px-2.5 py-1 rounded-full border ${user.faceShape ? "border-porcelain/60 text-ink bg-background/60" : "border-amber-400/40 text-amber-700 bg-amber-50/60"}`}>
                    Face · {user.faceShape ?? "—"}
                  </span>
                  <span className={`px-2.5 py-1 rounded-full border ${user.hairType ? "border-porcelain/60 text-ink bg-background/60" : "border-amber-400/40 text-amber-700 bg-amber-50/60"}`}>
                    Hair · {user.hairType ?? "—"}
                  </span>
                </div>
                {missing.length > 0 && (
                  <Link
                    to="/style-profile"
                    onClick={onClose}
                    className="mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-full border border-amber-400/40 bg-amber-50/60 text-amber-800 text-[10px] uppercase tracking-[0.2em] hover:bg-amber-50 transition-colors"
                  >
                    <AlertCircle className="h-3 w-3" strokeWidth={1.6} />
                    Complete {missing.join(", ")} in the Studio
                  </Link>
                )}
              </div>

              {/* Concierge Wallet */}
              <div className="relative overflow-hidden rounded-2xl border border-porcelain/50 bg-gradient-to-br from-atelier-champagne/30 via-background to-porcelain/20 p-6 shadow-atelier-soft">
                <div
                  aria-hidden
                  className="absolute -top-16 -right-16 h-44 w-44 rounded-full bg-atelier-champagne/30 blur-3xl pointer-events-none"
                />
                <div className="relative space-y-6">
                  <div className="flex items-end justify-between">
                    <span className="text-[10px] uppercase tracking-[0.25em] text-stone">
                      Concierge Access
                    </span>
                    <div className="text-right">
                      <div className="font-serif text-2xl text-ink leading-none">Atelier</div>
                      <div className="text-[10px] uppercase tracking-[0.2em] text-stone mt-1">
                        Membership
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <button
                      onClick={onAcquirePasses}
                      className="w-full py-3 rounded-lg bg-ink text-white text-[11px] uppercase tracking-[0.25em] font-semibold hover:bg-ink/90 transition-colors"
                    >
                      Acquire Passes
                    </button>

                    <button
                      onClick={onWatchEditorial}
                      className="w-full py-3 rounded-lg border border-stone/20 bg-background/60 text-[11px] uppercase tracking-[0.25em] text-ink hover:bg-white transition-colors flex items-center justify-center gap-3"
                    >
                      <span>View Partner Editorial</span>
                      <span className="text-[9px] text-stone normal-case tracking-normal">
                        +1 Pass
                      </span>
                    </button>

                    <p className="text-[10px] text-stone leading-relaxed text-center px-2">
                      Experience a brief presentation from our luxury partners to receive a
                      complimentary styling pass.
                    </p>
                  </div>
                </div>
              </div>

              {/* Quick Links */}
              <div className="space-y-px rounded-xl overflow-hidden border border-porcelain/40">
                <Link
                  to="/style-profile"
                  onClick={onClose}
                  className="flex items-center justify-between px-5 py-4 bg-background hover:bg-porcelain/20 transition-colors border-b border-porcelain/30"
                >
                  <span className="text-xs uppercase tracking-[0.2em] text-ink">
                    Review Color Dossier
                  </span>
                  <span className="text-stone">→</span>
                </Link>
                <Link
                  to="/history"
                  onClick={onClose}
                  className="flex items-center justify-between px-5 py-4 bg-background hover:bg-porcelain/20 transition-colors"
                >
                  <span className="text-xs uppercase tracking-[0.2em] text-ink flex items-center gap-2">
                    <Archive className="h-3.5 w-3.5" strokeWidth={1.5} />
                    Outfit Archive
                  </span>
                  <span className="text-stone">→</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Account Settings */}
              <div className="space-y-3">
                <p className="text-[10px] uppercase tracking-[0.25em] text-stone">
                  Account details
                </p>
                <div className="rounded-xl border border-porcelain/40 overflow-hidden">
                  <button className="w-full flex items-center justify-between px-5 py-4 bg-background hover:bg-porcelain/20 transition-colors border-b border-porcelain/30">
                    <span className="text-sm text-ink">Email &amp; Security</span>
                    <span className="text-stone">→</span>
                  </button>
                  <div className="flex items-center justify-between px-5 py-4">
                    <span className="text-sm text-ink">Membership Tier</span>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-stone">Free</span>
                  </div>
                </div>
              </div>

              {/* Styling Preferences */}
              <div className="space-y-3">
                <p className="text-[10px] uppercase tracking-[0.25em] text-stone">
                  Styling parameters
                </p>
                <div className="rounded-xl border border-porcelain/40 overflow-hidden divide-y divide-porcelain/30">
                  <div className="flex items-center justify-between px-5 py-4">
                    <span className="text-sm text-ink">Climate Measurement</span>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-stone">
                      Celsius (°C)
                    </span>
                  </div>
                  <button className="w-full flex items-center justify-between px-5 py-4 hover:bg-porcelain/20 transition-colors">
                    <span className="text-sm text-ink">Default Location</span>
                    <span className="text-stone">→</span>
                  </button>
                  <button className="w-full flex items-center justify-between px-5 py-4 hover:bg-porcelain/20 transition-colors">
                    <span className="text-sm text-ink">Privacy &amp; Data</span>
                    <span className="text-stone">→</span>
                  </button>
                </div>
              </div>

              {/* Danger Zone */}
              <div className="pt-4 border-t border-porcelain/30">
                <button
                  onClick={() => {
                    onClose();
                    signOut();
                  }}
                  className="w-full py-3 rounded-lg border border-destructive/30 text-destructive text-[11px] uppercase tracking-[0.25em] hover:bg-destructive/5 transition-colors"
                >
                  Sign Out of Studio
                </button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}