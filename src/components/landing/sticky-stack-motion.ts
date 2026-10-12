import type { gsap as Gsap } from "gsap";
import type { ScrollTrigger as ScrollTriggerPlugin } from "gsap/ScrollTrigger";

/**
 * Scroll motion for the home page's sticky stack. The stack renders as plain
 * stacked panels on the server, on narrow screens and under reduced motion;
 * this module only ever adds the pinning on top, on a wide screen with motion
 * allowed, after GSAP arrives by dynamic import. Nothing here runs at import
 * time, and the types above are erased, so the server bundle never loads GSAP.
 *
 * Why it moves: the panels arrive in the order a member uses Mila (read her
 * colors, compose the look, shop it), each settling back as the next one
 * scrolls over it. Only transform and opacity animate.
 */

/**
 * Marks a panel to pin. A panel has no background of its own: only its card
 * is opaque, so the next card slides straight over the pinned one with no
 * band of blank canvas between them (LANDING review C1).
 */
export const STACK_PANEL_ATTR = "data-stack-panel";
/** Marks the card inside a panel: the part that recedes as the next panel arrives. */
export const STACK_CARD_ATTR = "data-stack-card";
/** Set on the stack root while the pinning is live; the CSS closes the gaps between panels by it. */
export const STACK_MOTION_ATTR = "data-stack-motion";
/** Air between the sticky site header and a pinned card's top, in px. */
export const STACK_PIN_GAP = 16;

/** Wide enough for the two-column cards, and tall enough that a card fits under the header. */
export const STACK_DESKTOP_QUERY = "(min-width: 1024px) and (min-height: 640px)";
export const STACK_REDUCE_QUERY = "(prefers-reduced-motion: reduce)";
/** gsap.matchMedia reverts every pin the moment this stops matching. */
export const STACK_MOTION_QUERY =
  "(min-width: 1024px) and (min-height: 640px) and (prefers-reduced-motion: no-preference)";

type MatchMedia = (query: string) => { matches: boolean };

export type StackMotionLib = { gsap: typeof Gsap; ScrollTrigger: typeof ScrollTriggerPlugin };

/** Whether to load GSAP at all: a wide, tall enough screen, and no request for reduced motion. */
export function stackMotionAllowed(matchMedia: MatchMedia): boolean {
  return matchMedia(STACK_DESKTOP_QUERY).matches && !matchMedia(STACK_REDUCE_QUERY).matches;
}

/**
 * GSAP and ScrollTrigger, registered. The plugin has to be imported on its own
 * and registered before use.
 * src: https://gsap.com/docs/v3/Plugins/ScrollTrigger/ · gsap 3.15.0 · 2026-10-07
 */
export async function loadStackMotionLib(): Promise<StackMotionLib> {
  const [{ gsap }, { ScrollTrigger }] = await Promise.all([
    import("gsap"),
    import("gsap/ScrollTrigger"),
  ]);
  gsap.registerPlugin(ScrollTrigger);
  return { gsap, ScrollTrigger };
}

/**
 * Where a pinned card's top sits: just under the sticky site header. Read on
 * every ScrollTrigger refresh, so a header that grows with the text size moves
 * the pin with it.
 */
export function stackPinTop(doc: Document | null | undefined): number {
  const header = doc?.querySelector("header");
  return Math.round(header?.getBoundingClientRect().height ?? 0) + STACK_PIN_GAP;
}

/**
 * Pins every panel but the last just under the site header until the last
 * panel reaches that line (the taste skill's canonical sticky stack, offset
 * for the sticky header). Panels sit flush, so when a card pins, the next
 * card's top already touches its bottom and slides straight over it.
 *
 * A pinned card recedes (scale from its bottom edge, so that edge never
 * lifts off the incoming card) and fades fully out, but only while the next
 * card slides over it: from the moment they touch to the moment the next one
 * pins in its place. A card only starts to recede once it is pinned, so two
 * fading cards never overlap and nothing ghosts through an opaque card; the
 * hidden card also can't peek out around a shorter one when the pins release.
 *
 * Skipped when a card is taller than the room under the header: its bottom
 * would stay out of reach while pinned. The panels then stay static.
 *
 * Everything is created inside gsap.matchMedia, which reverts the pins and
 * inline styles when the query stops matching (window narrowed or shortened,
 * reduced motion turned on) and on the returned cleanup.
 * src: https://gsap.com/docs/v3/GSAP/gsap.matchMedia() · gsap 3.15.0 · 2026-10-07
 * src: https://gsap.com/docs/v3/Plugins/ScrollTrigger/ (pin, pinSpacing, endTrigger, scrub; function start/end re-read on refresh) · gsap 3.15.0 · 2026-10-07
 * src: https://gsap.com/docs/v3/GSAP/CorePlugins/CSS/ (autoAlpha hides at 0, transformOrigin) · gsap 3.15.0 · 2026-10-07
 */
export function startStackMotion(root: HTMLElement, { gsap, ScrollTrigger }: StackMotionLib) {
  const mm = gsap.matchMedia(root);
  mm.add(STACK_MOTION_QUERY, () => {
    const panels = gsap.utils.toArray<HTMLElement>(`[${STACK_PANEL_ATTR}]`, root);
    if (panels.length < 2) return;
    const doc = root.ownerDocument;
    const room = (doc?.defaultView?.innerHeight ?? Number.POSITIVE_INFINITY) - stackPinTop(doc);
    if (panels.some((panel) => panel.offsetHeight > room)) return;

    const last = panels[panels.length - 1];
    const pinLine = () => `top ${stackPinTop(doc)}px`;
    root.setAttribute(STACK_MOTION_ATTR, "on");

    panels.slice(0, -1).forEach((panel, i) => {
      ScrollTrigger.create({
        trigger: panel,
        start: pinLine,
        endTrigger: last,
        end: pinLine,
        pin: true,
        pinSpacing: false,
      });
      gsap.to(panel.querySelector<HTMLElement>(`[${STACK_CARD_ATTR}]`) ?? panel, {
        scale: 0.94,
        autoAlpha: 0,
        transformOrigin: "50% 100%",
        ease: "none",
        scrollTrigger: {
          trigger: panels[i + 1],
          start: () => `top ${stackPinTop(doc) + panel.offsetHeight}px`,
          end: pinLine,
          scrub: true,
        },
      });
    });

    // A late web-font swap above the stack moves everything under it; measure again.
    doc?.fonts?.ready.then(
      () => ScrollTrigger.refresh(),
      () => {},
    );

    return () => root.removeAttribute(STACK_MOTION_ATTR);
  });
  return () => mm.revert();
}

/**
 * The stack's effect body: loads GSAP only when motion is allowed and starts
 * the pinning unless the stack unmounted while GSAP was loading. A failed load
 * leaves the static panels, which are the complete page. Returns the cleanup.
 */
export function mountStackMotion(
  root: HTMLElement,
  {
    matchMedia,
    load = loadStackMotionLib,
    start = startStackMotion,
  }: {
    matchMedia: MatchMedia;
    load?: () => Promise<StackMotionLib>;
    start?: (root: HTMLElement, lib: StackMotionLib) => () => void;
  },
): () => void {
  if (!stackMotionAllowed(matchMedia)) return () => {};

  let unmounted = false;
  let stop: (() => void) | null = null;
  load().then(
    (lib) => {
      if (!unmounted) stop = start(root, lib);
    },
    () => {
      // The static stack is already the whole page; motion is an extra.
    },
  );
  return () => {
    unmounted = true;
    stop?.();
  };
}
