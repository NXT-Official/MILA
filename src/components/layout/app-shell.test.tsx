import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";
import { AuthContext } from "@/hooks/use-auth";
import { profileQueryOptions, type DashboardProfile } from "@/lib/queries/profile";
import { profileUsernameQueryOptions } from "@/lib/queries/profile-username";
import { AppShell } from "./app-shell";

const USER: User = {
  id: "user-1",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-01-01T00:00:00Z",
  email: "jane.doe@example.com",
};

function profileNamed(fullName: string | null): DashboardProfile {
  return {
    body_type: null,
    color_season: null,
    color_season_base: null,
    skin_undertone: null,
    full_name: fullName,
    face_shape: null,
    hair_type: null,
    beauty_preferences: null,
    color_profile: null,
    default_location: null,
    gender: null,
    hair_length: null,
    makeup_preference: null,
    shopping_preferences: null,
    styling_constraints: null,
    delivery_country: null,
    photo_consent_at: null,
    skin_depth: null,
    height_cm: null,
    weight_kg: null,
  };
}

/** The shell needs a router (links), the auth context and the member's cached profile. */
async function renderShell(member: { fullName: string | null; username: string | null }) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(profileQueryOptions(USER.id).queryKey, profileNamed(member.fullName));
  queryClient.setQueryData(profileUsernameQueryOptions(USER.id).queryKey, member.username);
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={{
            user: USER,
            session: null,
            loading: false,
            signingOut: false,
            signOut: async () => {},
          }}
        >
          <AppShell>
            <p>page</p>
          </AppShell>
        </AuthContext.Provider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/dashboard"] }),
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe("the app shell", () => {
  // The sign-in email is private; it must never stand in for a name in the
  // sidebar or the mobile header.
  test("names the member by their handle when they set no name, never by their email", async () => {
    const markup = await renderShell({ fullName: null, username: "mira.k" });

    expect(markup).toContain(">mira.k<");
    expect(markup).not.toContain("jane.doe");
  });

  test("names the member by the name they set", async () => {
    const markup = await renderShell({ fullName: "Jane Doe", username: "mira.k" });

    expect(markup).toContain(">Jane Doe<");
    expect(markup).not.toContain("jane.doe");
  });

  test("a member with neither name nor handle is simply a Member", async () => {
    const markup = await renderShell({ fullName: null, username: null });

    expect(markup).toContain(">Member<");
    expect(markup).not.toContain("jane.doe");
  });

  test("the gallery picker offers the same photo formats as every other picker", async () => {
    const markup = await renderShell({ fullName: null, username: null });

    expect(markup).toContain('accept="image/jpeg,image/png,image/webp,image/heic,image/heif"');
    expect(markup).not.toContain('accept="image/*"');
  });
});
