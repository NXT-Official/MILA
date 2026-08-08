# Product

## Register

product

## Users

Women roughly 25–45 who are style-curious but not stylists. They want to look
put-together every day without a personal-shopper budget and without spending
twenty minutes in front of a wardrobe.

Primary context is **phone, morning, getting dressed** — short sessions, low
patience, often one-handed. Secondary contexts: evening wardrobe-photo uploads,
dupe hunting while shopping, and browsing the community feed at leisure.

The job to be done: *"Tell me what to wear today, and make it right for my
colouring, my shape, and the weather — so I can stop deciding and get on with
my day."*

Two other user classes exist and matter, but they are not who the product is
designed around: moderators (queue triage, support tickets) and admins
(members, plans, moderation, support). Their surfaces optimize for throughput,
not warmth.

## Product Purpose

Mila builds a durable **style dossier** from a portrait — 16-season colour
analysis, body silhouette, face shape, hair type, beauty preferences — and then
generates every recommendation against that dossier rather than against generic
trend content. The dossier is recomposed daily with live weather and a chosen
occasion vibe into an outfit, hair, and makeup recommendation.

Around that core: wardrobe photo analysis, a dupe hunter for cheaper
equivalents, a conversational stylist, a moderated community feed, and credit /
subscription billing.

Success looks like a member who opens Mila before she opens her wardrobe, trusts
the answer without second-guessing it, and can say *why* the answer is right for
her.

## Brand Personality

**Discreet, expert, warm.**

Mila is a trusted personal stylist, not an app that shouts. Voice is calm and
declarative — it makes the call and gives one line of reasoning, rather than
hedging, over-explaining, or cheerleading. No hype, no gamification, no streaks,
no confetti. Warmth comes from tone, typography, and material (paper, ivory,
gold), never from emoji or exclamation marks.

Emotional goal: **quiet confidence.** She should close the app feeling that
someone who knows what they're doing already handled this.

## Anti-references

Four things Mila must never resemble:

1. **Generic SaaS dashboard.** Blue-and-white, hero stat tiles, endless
   identical card grids, Inter for everything, gradient accents. The default
   startup/AI look.
2. **Fast-fashion e-commerce** (Shein, Temu). Dense product grids, discount
   badges, urgency banners, countdown timers, visual noise. Mila recommends;
   it does not liquidate stock.
3. **Beauty-app cliché.** Millennial-pink gradients, bubbly oversized radii,
   emoji, quiz-app progress gamification, "You're a Summer! 🌸".
4. **Cold luxury minimalism.** Ultra-sparse all-caps monochrome fashion-house
   sites that read as unusable and unwelcoming. Mila is restrained *and*
   legible — restraint must never cost clarity.

## Design Principles

1. **The dossier is visible in the answer.** Every recommendation should let her
   see the thread back to her own profile — her season, her silhouette, today's
   weather. Personalization she can't perceive is indistinguishable from a
   guess.
2. **State the call; don't perform the reasoning.** One confident recommendation
   with one line of *why*. Not three options, not a confidence score, not a
   paragraph of AI narration.
3. **Morning-fast, phone-first.** The primary daily flow is designed for a
   distracted person on a small screen. One decision per screen, thumb-reachable
   actions, no horizontal scrolling, nothing that requires reading to act.
4. **One house across surfaces.** The Sanity-fed landing and the authenticated
   app are the same brand and the same system — the same tokens, type scale,
   radius hierarchy, and shadow language. A member should feel no seam at
   sign-up.
5. **Colour is content, not decoration.** This product is literally about
   colour. Palette swatches, season chips, and garment colours carry meaning, so
   decorative colour must stay out of their way — and meaning must never be
   encoded in hue alone.

## Accessibility & Inclusion

Target: **WCAG 2.2 AA**, with explicit colour-vision care.

- Body text ≥ 4.5:1 against its background; large text ≥ 3:1. Placeholder text
  is held to the same 4.5:1 as body text.
- **Never encode meaning in hue alone.** Season tags, status badges, moderation
  states, and credit warnings all need a label, icon, or shape in addition to
  colour. This is non-negotiable given the subject matter.
- Radix primitives are used unmodified for anything needing focus management,
  keyboard navigation, or portals — never reimplemented with `<div>`s.
- Visible focus on every interactive element (`mila-focus-ring` /
  `focus-visible`).
- `prefers-reduced-motion` gets a real alternative (crossfade or instant), not
  the removal of the affordance.
- Decorative icons `aria-hidden`; icon-only controls carry an `aria-label`.

No formal WCAG audit has been performed to date. New work is held to the bar
above, and violations found in existing surfaces get fixed in passing.
