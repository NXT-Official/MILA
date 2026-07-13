import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Preload a route's code (and any loader data, though these routes fetch
    // via useQuery instead) on link hover/touch. defaultPreloadStaleTime: 0
    // was previously set with no defaultPreload strategy, so it did nothing.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });

  return router;
};
