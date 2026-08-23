import { useReducedMotion } from "framer-motion";

/* ponytail: placeholder reel hotlinked from the design comp — wrong footage, and
   a third-party host that can vanish. Drop a MILA cut at /public/hero.mp4 and
   point here; the dev-only CSP hole in vite.config.ts goes away with it. */
const HERO_VIDEO =
  "https://pollen-batch-41236914.figma.site/_components/v2/f0ee2dae7671c170c34f12e31c4cb41418976c98/769c564298c132f7919405cd9f17c1b1231f341d.769c5642.mp4";

/**
 * The parallax ground. One `position: fixed` layer behind the whole page — the
 * sections above scroll past it, so the depth comes from the browser's own
 * compositor rather than a scroll listener moving things by hand.
 *
 * That means: nothing to throttle, nothing that desyncs on a fast flick, and it
 * degrades to a plain canvas ground when the reel can't play. Sections decide
 * what shows through purely by how opaque their own background is — `bg-canvas`
 * hides it, `bg-canvas/80` washes it, no background reveals it.
 */
export function HeroReel() {
  const reduce = useReducedMotion() ?? false;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 bg-canvas">
      {/* A looping reel is unrequested motion — under reduced-motion the canvas
          alone is the ground, and every section above still reads correctly. */}
      {!reduce && (
        <video
          className="size-full object-cover"
          src={HERO_VIDEO}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
      )}

      {/* One page-wide gradient over the reel, kept very faint on purpose. This
          layer is fixed, so it can never scroll with a section — anything strong
          here reads as a stationary dark band at the foot of the screen, which
          is the opposite of a continuous scroll. It settles the footage; the
          hero's own fade is what hands off to the sections. */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-canvas/8 to-canvas/20" />
    </div>
  );
}
