import { Link } from "@tanstack/react-router";
import { AlertCircle, Archive, ArrowRight, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AvatarInitial } from "@/components/ui/avatar-initial";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { CreditsUsageMeter } from "@/components/account/credits-usage-meter";
import { DEFAULT_AI_CREDITS } from "@/lib/credits";
import type { MySubscription } from "@/lib/queries/subscriptions";

interface MembershipViewProps {
  user: {
    fullName: string;
    username: string;
    season: string | null;
    faceShape: string | null;
    hairType: string | null;
  };
  authUserId: string | undefined;
  subscription: MySubscription | null | undefined;
  credits: number | null;
  onClose: () => void;
  resuming: boolean;
  onResume: () => void;
  onCancelClick: () => void;
}

export function MembershipView({
  user,
  authUserId,
  subscription,
  credits,
  onClose,
  resuming,
  onResume,
  onCancelClick,
}: MembershipViewProps) {
  const missing = [
    !user.season && "Color Season",
    !user.faceShape && "Face Shape",
    !user.hairType && "Hair Type",
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-2xl border border-porcelain/60 bg-linear-to-br from-atelier-champagne/25 via-background to-porcelain/20 p-4 shadow-atelier-soft">
        <div className="relative grid grid-cols-[auto_1fr_auto] items-center gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <AvatarInitial name={user.fullName || user.username} className="size-14 shrink-0" />

              <div className="min-w-0 flex flex-col">
                <p className="flex items-center gap-1.5 font-serif text-lg text-ink">
                  <span className="truncate">{user.fullName}</span>
                  {subscription && <VerifiedBadge className="size-4" />}
                </p>
                <p className="truncate text-label text-stone">@{user.username}</p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-pico uppercase tracking-label-tight">
              <Badge className="px-2 py-1 text-pico font-normal">
                Season · {user.season ?? "Unset"}
              </Badge>
              <Badge
                tone={user.faceShape ? "neutral" : "warning"}
                className="px-2 py-1 text-pico font-normal"
              >
                Face · {user.faceShape ?? "—"}
              </Badge>
              <Badge
                tone={user.hairType ? "neutral" : "warning"}
                className="px-2 py-1 text-pico font-normal"
              >
                Hair · {user.hairType ?? "—"}
              </Badge>
              {authUserId && (
                <Link
                  to="/profile/$userId"
                  params={{ userId: authUserId }}
                  onClick={onClose}
                  className="rounded-full border border-porcelain/60 bg-background/60 px-2 py-1 text-ink flex items-center gap-1.5"
                >
                  View Profile
                  <ArrowRight className="size-3" aria-hidden="true" />
                </Link>
              )}
            </div>
          </div>
        </div>
        {missing.length > 0 && (
          <Link
            to="/style-profile"
            onClick={onClose}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-warning/40 bg-warning/10 px-3 py-2 text-nano uppercase tracking-label text-warning transition-colors hover:bg-warning/15"
          >
            <AlertCircle className="size-3" strokeWidth={1.6} />
            Complete {missing.join(", ")} in the Studio
          </Link>
        )}
      </div>
      <div className="relative overflow-hidden rounded-2xl border border-porcelain/60 bg-linear-to-br from-atelier-champagne/30 via-background to-porcelain/20 p-6 shadow-atelier-soft">
        <div
          aria-hidden
          className="absolute -top-16 -right-16 h-44 w-44 rounded-full bg-atelier-champagne/30 blur-3xl pointer-events-none"
        />
        <div className="relative">
          <div className="flex flex-col gap-2 mb-3">
            <div className="flex items-end justify-between">
              <span className="atelier-label">Concierge Access</span>
              <div className="text-right">
                <div className="font-serif text-2xl text-ink leading-none">Atelier</div>
                <div className="text-micro uppercase tracking-label text-stone mt-1">
                  Membership
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="uppercase tracking-label text-stone text-micro">Current Tier</span>
              <span className="font-semibold text-ink">
                {subscription ? subscription.plan_title : "Free"}
              </span>
            </div>

            {subscription ? (
              <>
                <div className="flex items-center justify-between text-xs">
                  <span className="uppercase tracking-label text-micro text-stone">
                    {subscription.cancel_at_period_end ? "Ends" : "Renews"}
                  </span>
                  <span className="font-semibold text-ink">
                    {subscription.current_period_end
                      ? new Date(subscription.current_period_end).toLocaleDateString()
                      : "—"}
                  </span>
                </div>
                {subscription.cancel_at_period_end ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={onResume}
                    disabled={resuming}
                    className="w-full"
                  >
                    {resuming ? "Renewing…" : "Renew Membership"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={onCancelClick}
                    className="w-full"
                  >
                    Cancel Membership
                  </Button>
                )}
              </>
            ) : (
              <>
                <p className="pt-1 text-xs leading-relaxed text-stone">
                  Compare Atelier memberships and their included styling credits on the plans page.
                </p>
                <Link
                  to="/pricing"
                  onClick={onClose}
                  className="w-full py-3 rounded-lg border border-stone/20 bg-background/60 text-label uppercase tracking-label-wide text-ink hover:bg-accent-soft dark:hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
                >
                  View Membership Plans
                  <span aria-hidden="true">→</span>
                </Link>
              </>
            )}
          </div>

          {(subscription || (credits ?? 0) > 0) && (
            <CreditsUsageMeter
              remaining={credits ?? DEFAULT_AI_CREDITS}
              total={subscription?.credits_included ?? DEFAULT_AI_CREDITS}
            />
          )}

          {subscription && (credits ?? 0) === 0 && (
            <p className="text-micro text-center leading-relaxed text-stone">
              You're out of credits for today — they reset tomorrow.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-px rounded-xl overflow-hidden border border-porcelain/30">
        <Link
          to="/style-profile"
          onClick={onClose}
          className="flex items-center justify-between px-5 py-4 bg-background hover:bg-porcelain/20 transition-colors border-b border-porcelain/30"
        >
          <span className="text-micro uppercase tracking-label text-ink flex items-center gap-2">
            <Palette className="size-3.5" strokeWidth={1.75} />
            Review Color Dossier
          </span>
          <span className="text-stone">
            <ArrowRight className="size-3.5" strokeWidth={1.75} />
          </span>
        </Link>
        <Link
          to="/history"
          onClick={onClose}
          className="flex items-center justify-between px-5 py-4 bg-background hover:bg-porcelain/20 transition-colors"
        >
          <span className="text-micro uppercase tracking-label text-ink flex items-center gap-2">
            <Archive className="size-3.5" strokeWidth={1.75} />
            Outfit Archive
          </span>
          <span className="text-stone">
            <ArrowRight className="size-3.5" strokeWidth={1.75} />
          </span>
        </Link>
      </div>
    </div>
  );
}
