import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/landing/site-footer";
import { CtaButton } from "@/components/landing/cta-button";
import type { LandingContent } from "@/lib/landing-content";

export function MarketingSubpage({
  title,
  content,
  children,
}: {
  title: string;
  content: Pick<LandingContent, "footer" | "cta" | "subpageCta">;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="overflow-x-clip">
        <h1 className="sr-only">{title}</h1>

        <div className="atelier-container pt-8">
          <Link
            to="/"
            className="atelier-focus-ring inline-flex items-center gap-1.5 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to home
          </Link>
        </div>

        {children}

        <div className="atelier-container border-t border-border py-20 text-center sm:py-24">
          <h3 className="text-[clamp(2rem,4vw,3rem)] leading-[1.05]">
            {content.subpageCta.heading}
          </h3>
          <div className="mt-8 flex justify-center">
            <CtaButton labels={content.cta} />
          </div>
        </div>
      </main>
      <SiteFooter content={content.footer} />
    </div>
  );
}
