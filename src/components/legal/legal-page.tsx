import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/landing/site-footer";
import { LANDING_FALLBACK } from "@/lib/landing-content.fallback";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const { footer } = LANDING_FALLBACK;
  return (
    <div className="relative min-h-screen bg-background">
      <SiteHeader wordmark={footer.wordmark} />
      <main className="relative atelier-page max-w-3xl">
        <div className="mb-10 flex flex-col items-center text-center">
          <h1 className="atelier-title">{title}</h1>
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
      </main>
      <SiteFooter content={footer} />
    </div>
  );
}
