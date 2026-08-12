# Brand: Mila

This file covers only what the other two don't. It is not a second source of
truth for anything they already own:

- **[PRODUCT.md](PRODUCT.md)** — who Mila is for, brand personality, voice,
  anti-references, design principles.
- **[DESIGN.md](DESIGN.md)** — the palette (canonical values live in
  `src/styles.css`), typography, elevation, components.

What lives here: the mark, and the positioning that separates Mila from the
things it superficially resembles.

---

## 1. Positioning

**Mila is a stylist, not a styling tool.** The product makes the call. Every
competing category leaves the decision with the user and calls that empowerment.

| Category | What they do | What Mila does instead |
|---|---|---|
| Color-analysis apps | Hand you a season name and a swatch grid, then stop | Treats the 16-season profile as an input, not an output — the season is authoritative in every outfit, hair, and makeup instruction Mila writes |
| Wardrobe/closet managers | Ask you to photograph and tag your clothes first | Composes from first principles. Mila never asks what you own — the retired wardrobe module is why (see [TECHNICAL_CHANGELOG §11.2](../../Aura%20Style/TECHNICAL_CHANGELOG.md)) |
| Outfit-inspiration feeds | Show you what looked good on someone else | Weather, silhouette, face shape, and hair texture are all yours; the look is composed for today, where you are |
| AI chat assistants | Answer in paragraphs, hedge, offer options | One look, one headline, one line of reasoning. Alternatives are a re-roll, not a menu |

**The single-sentence version:** Mila answers "what should I wear?" — once,
every morning, with authority.

**Who it's for:** people who want to look considered without spending the
attention. They'll invest once in a real profile to stop deciding daily.

---

## 2. The Mark

`public/favicon.svg` — four overlapping circles around a gold center, on
porcelain.

```
        ┌───────────────┐
        │   ◕  ◕        │   4 seasonal fields, overlapping
        │     ◆         │   1 champagne gold core
        │   ◕  ◕        │
        └───────────────┘
```

**What it means.** The four fields are the seasonal axes — cool/warm, light/deep
— overlapping rather than partitioned, because a real coloring lands *between*
them. The gold core is the member: one specific point where the four agree. It
reads as a color wheel at a glance and as a mirror at second glance.

**Construction.** 200×200 viewBox. Four r=55 circles at (75,75), (125,75),
(75,125), (125,125); r=21 gold core at center; each stroked 5px in porcelain so
the fields stay separable at 16px. No gradients, no text, no drop shadow.

**Colors.** The core is Champagne Gold (`#c9a96e`) and the strokes and ground
are Porcelain (`#faf8f5`) — both straight from the design system. The four
fields are seasonal specimens and belong to the mark alone: `#afc6de` cool
light, `#f0cda9` warm light, `#c4703e` warm deep, `#7e93b3` cool deep. **Do not
add these four to the UI palette** — the system has one accent.

**Usage.**
- Clear space: one circle radius (≈27% of the mark's width) on all sides.
- Minimum size: 16px. Below that the strokes close up — use the gold core alone.
- Always on porcelain, paper cream, or ink. Never on a photograph, never on
  Champagne Gold, never inside a colored tile.
- It is decorative wherever the wordmark is adjacent — ship it as
  `alt=""` so screen readers get "MILA" once, not twice.

## 3. The Wordmark

**MILA**, set in Playfair Display, uppercase, wide tracking:

```html
<span class="font-serif text-xl tracking-label-xwide">MILA</span>
```

Live in `landing/site-header.tsx:23`, `login.tsx:24`, `onboarding.tsx:57`, and
`staff.tsx:24`. Lockup is mark-left, wordmark-right, `gap-2.5`, mark sized one
step above the cap height (`size-6` against `text-xl`).

Never: lowercase "mila" as a logo, letterforms in Inter, the wordmark inside a
box or pill, a tagline locked to the mark. The product tagline — *"Your
stylist. Every morning."* (`__root.tsx:51`) — travels in page titles and meta,
not in the logo.

## 4. Naming

"Mila" in prose and UI copy. "MILA" only as the wordmark. Never "MILA" mid-
sentence, never "Mila AI", never an emoji beside it.
