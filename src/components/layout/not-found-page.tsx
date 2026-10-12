import { Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/landing/site-footer";
import { Button } from "@/components/ui/button";
import { LANDING_FALLBACK } from "@/lib/landing-content.fallback";

/** The 404 page, framed by the same header and footer as the public site. */
export function NotFoundPage() {
  const { footer } = LANDING_FALLBACK;
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader wordmark={footer.wordmark} />
      <main className="atelier-container flex flex-1 items-center justify-center py-20">
        <div className="max-w-md text-center">
          <p className="text-xs font-medium tracking-label-xwide text-muted-foreground">404</p>
          <h1 className="mt-3 font-display text-3xl font-semibold text-ink">Page not found</h1>
          <p className="mt-3 text-sm text-muted">
            The page you are looking for does not exist or has moved.
          </p>
          <div className="mt-6 flex justify-center">
            <Button asChild>
              <Link to="/">Go home</Link>
            </Button>
          </div>
        </div>
      </main>
      <SiteFooter content={footer} />
    </div>
  );
}
