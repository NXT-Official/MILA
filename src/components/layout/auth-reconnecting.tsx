import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CloudOff } from "lucide-react";
import { runReconnectRetry, useAuthConnection } from "@/hooks/use-auth-connection";

const CHECKING_FEEDBACK_MS = 2500;

/**
 * Shown when her session is stored but could not be refreshed (offline, or the
 * auth server answered 5xx). She is still signed in, so this never sends her to
 * /login; the auth provider keeps retrying and the page comes back by itself.
 */
export function AuthReconnecting({
  onRetry,
  signInSearch,
  inline = false,
}: {
  onRetry: () => void;
  signInSearch: { redirect?: string };
  /** Inside a page that already has its own heading and frame. */
  inline?: boolean;
}) {
  const Heading = inline ? "h2" : "h1";
  const [checking, setChecking] = useState(false);
  const connection = useAuthConnection();

  useEffect(() => {
    if (!checking) return;
    const timer = window.setTimeout(() => setChecking(false), CHECKING_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [checking]);

  return (
    <div
      className={
        inline
          ? "flex items-center justify-center py-16"
          : "min-h-screen flex items-center justify-center bg-background px-6"
      }
    >
      <div className="max-w-md text-center">
        <CloudOff className="mx-auto size-8 text-stone" strokeWidth={1.2} aria-hidden="true" />
        <Heading className="mt-6 font-serif text-2xl tracking-label uppercase text-ink">
          Reconnecting
        </Heading>
        <p
          role="status"
          aria-live="polite"
          className="mt-3 text-sm text-stone leading-relaxed text-balance"
        >
          We can&apos;t reach MILA right now. You&apos;re still signed in, and we&apos;ll keep
          trying.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setChecking(true);
              runReconnectRetry(connection, onRetry);
            }}
            disabled={checking}
            aria-busy={checking}
            className="min-h-11 rounded-full bg-ink text-background text-micro uppercase tracking-label-wide px-6 py-2.5 disabled:opacity-70"
          >
            {checking ? "Checking…" : "Try again"}
          </button>
          <Link
            to="/login"
            search={signInSearch}
            className="inline-flex min-h-11 items-center px-3 text-xs text-stone underline underline-offset-4 hover:text-ink"
          >
            Sign in again
          </Link>
        </div>
      </div>
    </div>
  );
}
