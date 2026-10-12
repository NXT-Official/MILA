import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, LogOut, UserRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { useMemberIdentity } from "@/hooks/use-member-identity";

/**
 * The avatar's menu: who is signed in, the way into her account, and Sign out.
 *
 * Sign out used to live only at the foot of Account → Preferences, three clicks
 * and a scroll from anywhere in the app. Members look for it under the avatar,
 * so that is where it is now. Every other way out stays where it was.
 */
export function ProfileMenu({
  children,
  triggerClassName,
  side = "bottom",
  align = "end",
}: {
  /** What the trigger shows: the avatar, and in the expanded sidebar her name. */
  children: ReactNode;
  triggerClassName?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  const { signOut, signingOut } = useAuth();
  const { displayName, handle } = useMemberIdentity();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Your account" className={triggerClassName}>
        {children}
      </DropdownMenuTrigger>
      {/* p-2, not the primitive's p-1: a square item highlight 8px in clears the
          24px overlay corner, so Sign out's hover is not clipped. */}
      <DropdownMenuContent side={side} align={align} className="w-60 p-2">
        <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
          <span className="truncate font-serif text-base text-ink">{displayName}</span>
          {handle && <span className="truncate text-xs text-muted-foreground">@{handle}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* 44px rows on phone widths (a thumb, not a cursor); the primitive's
            compact rows from md up. */}
        <DropdownMenuItem asChild className="min-h-11 gap-2 md:min-h-0">
          <Link to="/account">
            <UserRound className="size-4" strokeWidth={1.75} aria-hidden="true" />
            Your account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="min-h-11 gap-2 md:min-h-0"
          disabled={signingOut}
          onSelect={(event) => {
            // Keep the menu open so "Signing out…" shows while the request is
            // out; on success the signed-in shell goes away, and if it fails
            // (the provider toasts) she is still here and can press it again.
            event.preventDefault();
            void signOut();
          }}
        >
          {signingOut ? (
            <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <LogOut className="size-4" strokeWidth={1.75} aria-hidden="true" />
          )}
          {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
