import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export function LegalPage({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-screen bg-background overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-24 h-105 w-105 rounded-full bg-atelier-champagne/25 blur-3xl" />
        <div className="absolute -bottom-32 -right-24 h-105 w-105 rounded-full bg-atelier-rose/20 blur-3xl" />
      </div>

      <div className="relative atelier-page max-w-3xl">
        <div className="mb-10 flex flex-col items-center text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-2.5 font-serif text-2xl tracking-label-xwide"
          >
            <img src="/favicon.svg" alt="" className="size-7" />
            MILA
          </Link>
          <p className="atelier-kicker mt-3">{kicker}</p>
          <h1 className="atelier-title mt-4">{title}</h1>
        </div>

        <article className="atelier-card mx-auto max-w-2xl space-y-5 p-6 text-sm leading-relaxed text-foreground sm:p-10">
          {children}
        </article>

        <div className="mt-8 text-center">
          <Link
            to="/"
            className="atelier-focus-ring inline-flex items-center gap-1.5 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
