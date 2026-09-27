import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="relative min-h-screen bg-background">
      <div className="relative atelier-page max-w-3xl">
        <div className="mb-10 flex flex-col items-center text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-2.5 font-serif text-2xl tracking-label-xwide"
          >
            <img src="/favicon.svg" alt="" className="size-7" />
            MILA
          </Link>
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
