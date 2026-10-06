import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { AuthContext } from "@/hooks/use-auth";
import { CAMERA_PERMISSION_HINT } from "@/lib/camera-errors";
import {
  CameraErrorNotice,
  CameraPermissionHint,
  CameraStatusLayer,
  VisualDiagnosticViewfinder,
} from "./visual-diagnostic-viewfinder";

/** Copy as it appears in the markup: React escapes quotes and ampersands. */
function text(copy: string) {
  return renderToStaticMarkup(<>{copy}</>);
}

/**
 * The camera chrome (close + switch camera in the header, "Upload a photo
 * instead" in the footer) sits on z-20. The error notice has to paint below
 * it, or a member whose camera is blocked has no button left to press.
 */
const CHROME_Z = 20;

function zIndexOf(markup: string): number {
  const match = /\bz-(\d+)\b/.exec(markup);
  return match ? Number(match[1]) : 0;
}

describe("CameraErrorNotice", () => {
  const markup = renderToStaticMarkup(<CameraErrorNotice message="No camera was found." />);

  test("shows the message", () => {
    expect(markup).toContain("No camera was found.");
  });

  test("paints below the camera chrome so close and upload stay reachable", () => {
    expect(zIndexOf(markup)).toBeLessThan(CHROME_Z);
  });

  test("keeps its copy clear of the header and the footer controls", () => {
    expect(markup).toMatch(/\bpt-\d+\b/);
    expect(markup).toMatch(/\bpb-\d+\b/);
  });
});

describe("CameraPermissionHint", () => {
  const markup = renderToStaticMarkup(<CameraPermissionHint />);

  test("says where to allow access and that upload still works", () => {
    expect(markup).toContain(text(CAMERA_PERMISSION_HINT));
    expect(markup).toContain('role="status"');
  });

  test("paints below the camera chrome and lets taps through to it", () => {
    expect(zIndexOf(markup)).toBeLessThan(CHROME_Z);
    expect(markup).toContain("pointer-events-none");
  });
});

describe("CameraStatusLayer", () => {
  const NOTES = ["Waiting for the right light…", "Opening the camera…"];
  const ALIGN_GUIDE = "Align your profile boundaries within the guide";

  function layer(overrides: Partial<Parameters<typeof CameraStatusLayer>[0]> = {}) {
    return renderToStaticMarkup(
      <CameraStatusLayer
        streamErr={null}
        analyzing={false}
        permissionHint={false}
        notes={NOTES}
        {...overrides}
      />,
    );
  }

  test("with a working camera it shows the studio notes and the framing guide", () => {
    const markup = layer();

    expect(markup).toContain("Studio notes");
    expect(markup).toContain("Opening the camera…");
    expect(markup).toContain(ALIGN_GUIDE);
    expect(markup).not.toContain('role="alert"');
  });

  // At 640-910px the notes panel (z-30) used to paint over the notice (z-10).
  test("while the camera error shows, the studio notes are not on screen at all", () => {
    const markup = layer({ streamErr: "No compatible camera was detected on this device." });

    expect(markup).toContain("No compatible camera was detected on this device.");
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain("Studio notes");
    expect(markup).not.toContain("Opening the camera…");
    expect(markup).not.toMatch(/\bz-30\b/);
    expect(markup).not.toContain(ALIGN_GUIDE);
  });

  test("a camera error is not shown over a photo that is being read", () => {
    const markup = layer({ streamErr: "No compatible camera.", analyzing: true });

    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain(ALIGN_GUIDE);
  });

  test("a permission prompt that is still waiting gets a hint that points at upload", () => {
    const markup = layer({ permissionHint: true });

    expect(markup).toContain(text(CAMERA_PERMISSION_HINT));
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain(ALIGN_GUIDE);
  });

  test("the hint is never shown beside a camera error or over a photo being read", () => {
    const withError = layer({ permissionHint: true, streamErr: "No compatible camera." });
    const reading = layer({ permissionHint: true, analyzing: true });

    expect(withError).not.toContain(text(CAMERA_PERMISSION_HINT));
    expect(reading).not.toContain(text(CAMERA_PERMISSION_HINT));
  });

  test("no hint appears before the wait is over", () => {
    expect(layer()).not.toContain(text(CAMERA_PERMISSION_HINT));
  });
});

/** The briefing screen needs a router (useServerFn), a query client and the auth context. */
async function renderBriefing() {
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={new QueryClient()}>
        <AuthContext.Provider
          value={{
            user: null,
            session: null,
            loading: false,
            signingOut: false,
            signOut: async () => {},
          }}
        >
          <VisualDiagnosticViewfinder onClose={() => {}} onComplete={() => {}} />
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

describe("the lighting briefing", () => {
  // Without a saved selfie there is no style-sheet picture at all (the render
  // needs the member's own photo), so "a generic model instead" was not true.
  test("the photo-consent copy makes no promise of a generic model", async () => {
    const markup = await renderBriefing();

    expect(markup).toContain("Save this photo so Mila can put your own face in your generated");
    expect(markup).toContain("analyzed and discarded");
    expect(markup).not.toMatch(/generic/i);
  });
});
