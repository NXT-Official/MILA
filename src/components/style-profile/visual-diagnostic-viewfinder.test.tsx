import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CameraErrorNotice } from "./visual-diagnostic-viewfinder";

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
