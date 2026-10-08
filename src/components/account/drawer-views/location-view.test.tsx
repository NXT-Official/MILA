import * as React from "react";
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HUBS } from "@/constants/climate";
import { LocationView } from "./location-view";

type Props = Parameters<typeof LocationView>[0];

function renderView(overrides: Partial<Props> = {}) {
  const props: Props = {
    defaultHubId: HUBS[0].id,
    onSelectHub: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(<LocationView {...props} />);
}

/** Every element in the (un-rendered) tree a function component returned. */
function elementsOf(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) {
    return Array.isArray(node) ? node.flatMap(elementsOf) : [];
  }
  return [node, ...elementsOf(node.props.children as React.ReactNode)];
}

function clickable(overrides: Partial<Props>) {
  const tree = LocationView({
    defaultHubId: HUBS[0].id,
    onSelectHub: () => {},
    ...overrides,
  });
  return elementsOf(tree).filter(
    (el) => typeof el.props.onClick === "function",
  ) as React.ReactElement<{ onClick: () => void }>[];
}

describe("LocationView", () => {
  test("shows no error and no spinner by default", () => {
    const out = renderView();
    expect(out).not.toContain('role="alert"');
    expect(out).not.toContain("animate-spin");
  });

  test("a failed save is announced with a calm message and a retry for that hub", () => {
    const out = renderView({ failedHubId: HUBS[1].id });
    expect(out).toContain('role="alert"');
    expect(out).toContain("We couldn&#x27;t save your location");
    const retry = out.match(/<button[^>]*>Try again<\/button>/)?.[0] ?? "";
    expect(retry).toContain("min-h-11");
    expect(retry).not.toContain('disabled=""');
    expect(out).toContain(HUBS[1].city);
    expect(out).not.toMatch(/[–—]/);
  });

  test("while a hub is saving, rows stay focusable but are marked disabled, and the saving one shows progress", () => {
    const out = renderView({ savingHubId: HUBS[1].id });
    const rows = out.match(/<button[^>]*atelier-row-action[^>]*>/g) ?? [];
    expect(rows).toHaveLength(HUBS.length);
    for (const row of rows) {
      // aria-disabled keeps the control in the tab order, so focus is not dropped
      expect(row).toContain('aria-disabled="true"');
      expect(row).not.toContain('disabled=""');
    }
    expect(out.match(/animate-spin/g)?.length).toBe(1);
    expect(out).toContain('role="status"');
  });

  test("the retry button also stays focusable while the retry is running", () => {
    const out = renderView({ failedHubId: HUBS[1].id, savingHubId: HUBS[1].id });
    const retry = out.match(/<button[^>]*>Try again<\/button>/)?.[0] ?? "";
    expect(retry).toContain('aria-disabled="true"');
    expect(retry).not.toContain('disabled=""');
  });

  test("a tap while a save is running does nothing", () => {
    const onSelectHub = mock(() => {});
    for (const el of clickable({ savingHubId: HUBS[1].id, onSelectHub })) el.props.onClick();
    expect(onSelectHub).not.toHaveBeenCalled();
  });

  test("a failed save retried while another save runs is also ignored", () => {
    const onSelectHub = mock(() => {});
    const handlers = clickable({
      failedHubId: HUBS[2].id,
      savingHubId: HUBS[1].id,
      onSelectHub,
    });
    expect(handlers.length).toBe(HUBS.length + 1);
    for (const el of handlers) el.props.onClick();
    expect(onSelectHub).not.toHaveBeenCalled();
  });

  test("with nothing running, a tap selects that hub and retry re-selects the failed one", () => {
    const onSelectHub = mock((_id: string) => {});
    // the alert (and its retry) sits above the list, so it comes first
    const [retry, firstRow] = clickable({ failedHubId: HUBS[2].id, onSelectHub });
    firstRow.props.onClick();
    expect(onSelectHub).toHaveBeenLastCalledWith(HUBS[0].id);
    retry.props.onClick();
    expect(onSelectHub).toHaveBeenLastCalledWith(HUBS[2].id);
  });

  test("the saved hub keeps its check mark and is marked current for assistive tech", () => {
    const out = renderView({ defaultHubId: HUBS[2].id });
    expect(out.match(/lucide-check/g)?.length).toBe(1);
    expect(out.match(/aria-current="true"/g)?.length).toBe(1);
    const current = out.match(/<button[^>]*aria-current="true"[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(current).toContain(HUBS[2].city);
  });
});
