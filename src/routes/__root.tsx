import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { AuthProvider } from "@/components/layout/auth-provider";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { ErrorState } from "@/components/ui/error-state";
import { captureClientException } from "@/lib/sentry-client";
import { capturePageview } from "@/lib/posthog-client";
import { OG_IMAGE_PATH, SITE_CONTEXT_ROUTE_OPTIONS, siteFromMatches } from "@/lib/site-seo";
import { getSiteContext } from "@/lib/site-context.functions";
import { createSiteContextLoader } from "@/lib/site-context.loader";
import { NotFoundPage } from "@/components/layout/not-found-page";

function NotFoundComponent() {
  return <NotFoundPage />;
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  captureClientException(error);
  const router = useRouter();

  return (
    <ErrorState
      title="This page didn't load"
      description="Something went wrong on our end. You can try refreshing or head back home."
      action={{
        label: "Try again",
        onClick: () => {
          router.invalidate();
          reset();
        },
      }}
      secondaryAction={{ label: "Go home", href: "/" }}
    />
  );
}

// Captures an SPA pageview on every route change, including the initial
// load, so PostHog sees the same navigation the member does. The raw href can
// carry sign-in tokens (#access_token=, ?code=, ?token_hash=, ?redirect=);
// capturePageview sanitizes it, so it never leaves the browser as-is.
function PostHogPageviews() {
  const location = useRouterState({ select: (s) => s.location });
  useEffect(() => {
    capturePageview(window.location.href);
  }, [location.href]);
  return null;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  ...SITE_CONTEXT_ROUTE_OPTIONS,
  loader: createSiteContextLoader(getSiteContext),
  head: ({ loaderData }) => {
    const site = loaderData ?? siteFromMatches(undefined);
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
        { title: "Mila: Your stylist. Every morning." },
        {
          name: "description",
          content: "Your AI personal stylist. Daily outfits built on your color season and shape.",
        },
        { name: "author", content: "Mila" },
        { property: "og:title", content: "Mila: Your stylist. Every morning." },
        {
          property: "og:description",
          content:
            "Mila composes your daily look around your color season, your silhouette, and the weather outside.",
        },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "Mila" },
        { property: "og:image", content: `${site.origin}${OG_IMAGE_PATH}` },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { name: "twitter:card", content: "summary_large_image" },
        ...(site.indexable ? [] : [{ name: "robots", content: "noindex" }]),
        { name: "twitter:image", content: `${site.origin}${OG_IMAGE_PATH}` },
      ],
      links: [
        {
          rel: "stylesheet",
          href: appCss,
        },
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
        { rel: "manifest", href: "/site.webmanifest" },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap",
        },
      ],
    };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script src="/theme-init.js" />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <Outlet />
          <PostHogPageviews />
          <Toaster />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
