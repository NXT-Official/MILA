import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { AuthContext } from "@/hooks/use-auth";

/**
 * Static markup for a component that needs the app's providers: a router
 * (Link, navigate), the auth context and a query client. Pass a prepared
 * `queryClient` to render against cached query data.
 */
export async function renderAppMarkup(
  node: ReactNode,
  { userId = null, queryClient }: { userId?: string | null; queryClient?: QueryClient } = {},
): Promise<string> {
  const client = queryClient ?? new QueryClient();
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        <AuthContext.Provider
          value={{
            user: userId ? ({ id: userId } as never) : null,
            session: null,
            loading: false,
            signingOut: false,
            signOut: async () => {},
          }}
        >
          {node}
        </AuthContext.Provider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

/** Copy as it appears in markup: React escapes quotes, ampersands and angle brackets. */
export function asMarkup(copy: string): string {
  return renderToStaticMarkup(<>{copy}</>);
}
