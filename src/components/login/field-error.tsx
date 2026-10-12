import { cn } from "@/lib/utils";

interface FieldErrorProps {
  id: string;
  message: string | undefined;
  /**
   * Announce the message to screen readers (default). Pass `false` when another
   * live region, such as a toast, already announces the same words.
   */
  announce?: boolean;
}

/**
 * The message under a field, tied to its input through `aria-describedby`.
 *
 * Announced politely, not as an alert: a field validates on every keystroke
 * after its first blur, and an assertive alert would cut in on each one. The
 * region is on the page before it has anything to say (empty and `sr-only`, so
 * it takes no room), because a live region that appears together with its text
 * is announced unreliably.
 */
export function FieldError({ id, message, announce = true }: FieldErrorProps) {
  if (!announce && !message) return null;
  return (
    <p
      id={id}
      aria-live={announce ? "polite" : undefined}
      className={cn(message ? "text-xs text-destructive" : "sr-only")}
    >
      {message}
    </p>
  );
}
