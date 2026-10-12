import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCOUNT_SECTIONS, type AccountSection } from "./account-sections";

/**
 * The account sections as one vertical list at every width. Below `lg` it is a
 * full-width card of tall rows (icon, label, chevron); from `lg` up it is a
 * quiet side list. Nothing in here scrolls sideways, whatever the viewport.
 */
export function AccountMenu({
  current,
  onSelect,
  className,
}: {
  /** The open section, or null when none is open (the phone menu screen). */
  current: AccountSection | null;
  onSelect: (section: AccountSection) => void;
  className?: string;
}) {
  return (
    <nav aria-label="Account sections" className={className}>
      <ul className="m-0 list-none divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface p-0 lg:flex lg:flex-col lg:gap-1 lg:divide-y-0 lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent">
        {ACCOUNT_SECTIONS.map(({ id, label, icon: Icon }) => {
          const isCurrent = current === id;
          return (
            <li key={id}>
              <button
                type="button"
                id={`account-section-${id}`}
                onClick={() => onSelect(id)}
                aria-current={isCurrent ? "page" : undefined}
                className={cn(
                  "atelier-focus-ring flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors max-lg:focus-visible:ring-inset max-lg:focus-visible:ring-offset-0 lg:min-h-11 lg:rounded-control lg:py-2.5",
                  isCurrent
                    ? "bg-accent-soft font-medium text-ink shadow-[inset_3px_0_0_0_var(--color-accent)]"
                    : "text-ink hover:bg-accent-soft/30 lg:text-muted-foreground lg:hover:text-ink",
                )}
              >
                <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <span className="min-w-0 flex-1">{label}</span>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground lg:hidden"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Account layout. Phone and tablet: the list is its own screen, and picking a
 * row opens that section with a "Back to account" control. From `lg` up: the
 * list sits beside the open section. Which one shows is CSS only, so the
 * server render and the first client render agree.
 */
export function AccountShell({
  section,
  wide,
  onSelect,
  onBack,
  children,
  menuFooter,
}: {
  /** The section the member opened, or null while they are still on the list. */
  section: AccountSection | null;
  /** True from the `lg` breakpoint up; only drives aria-current and focus. */
  wide: boolean;
  onSelect: (section: AccountSection) => void;
  onBack: () => void;
  children: React.ReactNode;
  /** Optional links under the section list (e.g. "Saved pieces"); hidden with the list. */
  menuFooter?: React.ReactNode;
}) {
  const open = section !== null;
  const shown = section ?? "membership";
  const label = ACCOUNT_SECTIONS.find((s) => s.id === shown)?.label ?? "";

  const headingRef = React.useRef<HTMLHeadingElement>(null);
  // Starts at the section already open on arrival (a deep link), so loading
  // the page straight onto a section does not move focus.
  const previousSection = React.useRef<AccountSection | null>(section);

  // Opening a section moves focus to its heading, and going back returns focus
  // to the row that was open, so keyboard and screen-reader users are never
  // left on a control that just disappeared. Only on a real change of section:
  // rotating a tablet must not pull focus out of a field.
  React.useEffect(() => {
    const previous = previousSection.current;
    previousSection.current = section;
    if (wide || previous === section) return;
    if (section) {
      headingRef.current?.focus();
    } else if (previous) {
      document.getElementById(`account-section-${previous}`)?.focus();
    }
  }, [section, wide]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr] lg:gap-8">
      <div data-account-menu="" className={cn(open && "max-lg:hidden")}>
        <AccountMenu current={wide ? shown : section} onSelect={onSelect} />
        {menuFooter}
      </div>

      <div data-account-detail="" className={cn("min-w-0", !open && "max-lg:hidden")}>
        <div className="mb-5 lg:hidden">
          <button
            type="button"
            data-account-back=""
            onClick={onBack}
            className="atelier-focus-ring -ml-2 inline-flex min-h-11 items-center gap-1 rounded-control px-2 text-sm text-muted-foreground transition-colors hover:text-ink lg:hidden"
          >
            <ChevronLeft className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            Back to account
          </button>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="mt-1 font-serif text-2xl text-ink outline-none"
          >
            {label}
          </h2>
        </div>
        {children}
      </div>
    </div>
  );
}
