# Task: Refactor Mila Typography to Poppins, Semantic HTML, and Theme-Matched shadcn/ui

Update the **MILA web app** so that:

1. The entire website uses **Poppins** as the primary font.
2. Text uses proper **semantic HTML elements** such as `h1`–`h6`, `p`, `small`, `label`, `strong`, `details`, `summary`, etc.
3. UI components use **shadcn/ui patterns and components** wherever appropriate.
4. All shadcn/ui components must visually match **Mila's existing website theme**.
5. Do **not** introduce the default black/gray shadcn appearance if it does not match Mila.
6. Preserve all existing functionality, architecture, responsiveness, and business logic.

Read `CLAUDE.md`, `README.md`, `src/styles.css`, and the existing `src/components/ui/` components before making changes.

This is primarily a **typography + semantic HTML + UI consistency refactor**, not a full visual redesign.

---

# 1. First Audit the Existing Application

Before modifying code, inspect the project.

Determine:

- how the current font is loaded;
- which font is currently being used;
- how Tailwind CSS v4 is configured;
- how Mila's theme tokens are declared;
- which shadcn/Radix components already exist;
- which reusable components already exist under:

```text
src/components/ui/
```

- which components are custom;
- which components could safely be replaced or standardized with shadcn/ui;
- which colors are currently used throughout the website;
- how light and dark modes are implemented.

Pay particular attention to:

```text
src/styles.css
```

The existing Mila theme is the source of truth.

Do not blindly overwrite the theme with shadcn defaults.

---

# 2. Use shadcn/ui as the Main Component System

Use **shadcn/ui conventions** for reusable UI primitives wherever appropriate.

Examples include:

```text
Button
Input
Textarea
Label
Card
Badge
Dialog
AlertDialog
DropdownMenu
Select
Tabs
Tooltip
Popover
Accordion
Sheet
Separator
Skeleton
Avatar
Checkbox
Switch
RadioGroup
Progress
Alert
Form-related primitives
```

Use the components that actually fit Mila's existing UI.

Do not install or create every shadcn component unnecessarily.

Only use components that are required by the application.

---

# 3. Important: shadcn Must Match Mila's Theme

Do **not** make Mila look like a default shadcn project.

shadcn/ui should provide:

- component structure;
- accessibility;
- Radix integration;
- component APIs;
- reusable variants;
- consistent interaction patterns.

But **Mila's existing visual identity must remain the source of truth**.

The components should look like they were designed specifically for Mila.

---

# 4. Mila Theme Is the Source of Truth

The project already has semantic design tokens such as:

```text
canvas
surface
ink
muted
accent
accent-soft
line
success
warning
destructive
```

Continue using them.

If the website already has additional theme tokens, preserve them as well.

For example, instead of default shadcn styling such as:

```tsx
bg - background;
text - foreground;
border - border;
```

map the component appropriately to Mila's existing semantic system.

Conceptually:

```text
background     → canvas
card           → surface
foreground     → ink
muted          → muted
primary        → accent
primary-soft   → accent-soft
border         → line
destructive    → destructive
success        → success
warning        → warning
```

Do not assume these mappings blindly.

Inspect `src/styles.css` and determine the correct mapping based on the actual theme.

---

# 5. Do Not Introduce Random Colors

Avoid hardcoded styling such as:

```tsx
bg - black;
bg - white;
text - gray - 500;
border - gray - 200;
bg - zinc - 950;
text - slate - 600;
```

unless there is a very specific design requirement that already exists in Mila.

Also avoid:

```tsx
bg-[#FFFFFF]
text-[#171717]
border-[#E5E5E5]
```

when Mila already has a semantic token for the same purpose.

Prefer:

```tsx
bg - surface;
text - ink;
text - muted;
border - line;
bg - accent;
text - accent - foreground;
```

or whatever naming is already used by the Mila theme.

---

# 6. Adapt shadcn Components to Mila

When adding or updating a shadcn component, customize its variants so it uses Mila's tokens.

For example, a Mila button should conceptually look like:

```tsx
<Button>Generate Look</Button>
```

while the underlying variant may use:

```text
bg-accent
text appropriate for accent background
hover state derived from accent
focus ring derived from accent
```

rather than shadcn's default neutral styling.

Similarly:

### Card

Use:

```text
surface
line
ink
muted
```

instead of generic shadcn neutral colors.

### Dialog

Use Mila's:

```text
surface
ink
muted
line
```

### Inputs

Use Mila's:

```text
surface/canvas
line
ink
muted
accent focus state
```

### Badges

Use semantic colors such as:

```text
accent
success
warning
destructive
```

depending on meaning.

---

# 7. Preserve Mila's Existing Personality

shadcn should **not** flatten Mila into a generic admin dashboard.

Keep Mila's current:

- spacing;
- softness;
- border radius;
- visual hierarchy;
- color palette;
- card treatment;
- background treatment;
- light/dark styling;
- feminine/personal styling personality;
- member-facing application feel.

If Mila uses softer or larger border radii than stock shadcn, keep those.

If Mila uses custom shadows, keep those where appropriate.

If Mila uses softer accent backgrounds, preserve them.

---

# 8. shadcn Component Variants

Use `class-variance-authority` for real variants.

For example:

```text
Button
  default
  secondary
  outline
  ghost
  destructive
```

But make those variants match Mila.

Conceptually:

```text
default
→ accent background

secondary
→ accent-soft or surface treatment

outline
→ transparent/surface with line border

ghost
→ transparent with Mila hover state

destructive
→ destructive theme
```

Do not copy shadcn colors blindly.

---

# 9. Reuse Existing Components Before Creating New Ones

Before creating a new shadcn component, inspect:

```text
src/components/ui/
```

If Mila already has:

```text
Button
Input
Card
Dialog
Label
Badge
```

determine whether it is already based on shadcn/Radix.

If so:

**update the existing component instead of creating a duplicate.**

Avoid ending up with:

```text
Button.tsx
button.tsx
MilaButton.tsx
CustomButton.tsx
```

for the same purpose.

There should be one clear primitive.

---

# 10. Use shadcn CLI Carefully

If shadcn is already initialized, use the existing setup.

If a component needs to be added, use the appropriate shadcn component implementation.

However, after adding it:

**immediately adapt its classes to Mila's theme.**

Do not leave stock shadcn colors in the codebase.

Also do not overwrite customized Mila components without reviewing the diff.

---

# 11. Poppins Font

Replace the application's current primary font with:

**Poppins**

Use a clean, production-ready approach compatible with TanStack Start + Vite.

Prefer local bundling through something like Fontsource if appropriate.

Use only necessary weights:

```text
400 Regular
500 Medium
600 SemiBold
700 Bold
```

Only include `300` if the existing design genuinely requires it.

Avoid loading all available Poppins weights.

---

# 12. Global Poppins Configuration

Poppins should be configured globally.

Developers should **not** need to write:

```tsx
className = "font-poppins";
```

everywhere.

Configure the global sans-serif font through Mila's Tailwind CSS v4 `@theme` setup.

Conceptually:

```css
--font-sans: "Poppins", ui-sans-serif, system-ui, sans-serif;
```

Then ensure the root/body uses the correct font token.

Follow the actual structure of `src/styles.css`.

Do not introduce a legacy `tailwind.config.js` just for fonts.

---

# 13. Remove the Previous Font

After Poppins is confirmed working:

search the repository for the old font.

Remove obsolete:

- font imports;
- font packages;
- CSS variables;
- `@font-face` declarations;
- Google Font `<link>` elements;
- Tailwind font utilities;
- unused font configuration.

Do not remove anything until you verify it is no longer used.

---

# 14. Typography Should Use Semantic HTML

Refactor textual content so semantic HTML is used appropriately.

Use:

```html
<h1>
  <h2>
    <h3>
      <h4>
        <h5>
          <h6>
            <p>
              <span>
                small
                <label>
                  <strong>
                    <em>
                      <blockquote>
                        <figcaption>
                          <legend>
                            <details>
                              <summary></summary>
                            </details>
                          </legend>
                        </figcaption></blockquote></em></strong></label
              ></span>
            </p>
          </h6>
        </h5>
      </h4>
    </h3>
  </h2>
</h1>
```

where semantically correct.

Do not perform blind replacement.

---

# 15. Heading Hierarchy

Heading levels represent structure, not merely visual size.

A normal page should generally have one primary:

```html
<h1></h1>
```

Example:

```tsx
<h1 className="text-3xl font-semibold tracking-tight text-ink">Style Profile</h1>
```

Then sections:

```tsx
<h2 className="text-xl font-semibold text-ink">Your Colour Season</h2>
```

Then nested subsections:

```tsx
<h3 className="text-lg font-semibold text-ink">Recommended Colours</h3>
```

Continue naturally with `h4`, `h5`, and `h6` only when hierarchy requires it.

Do not jump levels simply to achieve a visual font size.

---

# 16. Example Page Structure

Prefer semantic structures like:

```tsx
<main>
  <header>
    <h1>Today's Style</h1>

    <p className="text-muted">Recommendations personalized for your profile.</p>
  </header>

  <section>
    <h2>Today's Recommendation</h2>

    <Card>
      <CardHeader>
        <CardTitle>Outfit</CardTitle>
      </CardHeader>

      <CardContent>
        <p>...</p>
      </CardContent>
    </Card>
  </section>
</main>
```

This combines:

- semantic HTML;
- shadcn structure;
- Mila styling.

---

# 17. shadcn Card Semantics

Where appropriate use:

```tsx
<Card>
  <CardHeader>
    <CardTitle>...</CardTitle>
    <CardDescription>...</CardDescription>
  </CardHeader>

  <CardContent>...</CardContent>
</Card>
```

However, verify what the existing implementation renders.

If `CardTitle` is not semantically appropriate for the page hierarchy, provide an appropriate semantic implementation.

For example, allow something like:

```tsx
<CardTitle asChild>
  <h3>Outfit</h3>
</CardTitle>
```

if the component supports it.

Do not create invalid heading hierarchy merely because shadcn has `CardTitle`.

---

# 18. Paragraphs

Use `<p>` for actual blocks of prose.

Before:

```tsx
<div className="text-sm text-muted">Mila uses your profile to personalize recommendations.</div>
```

After:

```tsx
<p className="text-sm leading-relaxed text-muted">
  Mila uses your profile to personalize recommendations.
</p>
```

Use paragraphs for:

- onboarding descriptions;
- card descriptions;
- empty states;
- AI explanations;
- modal descriptions;
- helper content;
- profile descriptions;
- informational copy.

---

# 19. Labels

Forms should use actual labels.

Prefer shadcn's `Label` primitive if available.

Example:

```tsx
<Label htmlFor="occasion">
  Occasion
</Label>

<Input
  id="occasion"
  ...
/>
```

Do not use:

```tsx
<div>Occasion</div>
<Input />
```

Make sure labels correctly associate with their controls.

---

# 20. Input Styling

All shadcn form inputs should match Mila.

For example:

```text
Background:
surface or appropriate form token

Text:
ink

Placeholder:
muted

Border:
line

Focus:
accent

Disabled:
existing Mila disabled treatment

Error:
destructive
```

Do not use stock gray borders if Mila already defines `line`.

---

# 21. Buttons

Buttons should continue using actual `<button>` semantics through the shared shadcn `Button`.

Example:

```tsx
<Button>Generate Look</Button>
```

Do not create clickable:

```tsx
<div onClick={...}>
```

or:

```tsx
<p onClick={...}>
```

for actions.

---

# 22. Button Theme

Make the primary Mila button use the existing Mila accent.

For example, conceptually:

```text
Primary
accent background
proper readable foreground
accent hover state

Secondary
accent-soft or surface

Outline
line border
surface/transparent background

Ghost
transparent
Mila hover background

Destructive
destructive
```

Do not hardcode colors.

---

# 23. Dialogs

Use shadcn/Radix Dialog components where appropriate:

```tsx
<Dialog>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>...</DialogTitle>
      <DialogDescription>...</DialogDescription>
    </DialogHeader>
  </DialogContent>
</Dialog>
```

Keep:

- focus trapping;
- keyboard accessibility;
- screen reader semantics;
- close behavior;
- responsive behavior.

Style Dialog content using Mila:

```text
surface
ink
muted
line
```

---

# 24. Alerts

If Mila displays success, warning, info, or error messages, use a consistent shadcn `Alert` pattern where appropriate.

Map statuses to Mila tokens:

```text
success → success
warning → warning
error → destructive
informational → accent / accent-soft
```

Do not introduce unrelated blue/green/red hardcoded values if semantic theme variables exist.

---

# 25. Badges

Standardize badges with the shared shadcn `Badge`.

Possible semantic variants:

```text
default
secondary
success
warning
destructive
outline
```

Each should use Mila theme tokens.

For example:

```tsx
<Badge variant="success">Active</Badge>
```

---

# 26. Tabs

Where tabs exist, use the existing/shadcn Radix Tabs implementation.

Theme it with Mila.

Active state should use the existing Mila accent treatment rather than generic shadcn neutral styling.

---

# 27. Select / Dropdown / Popover

Keep or use shadcn/Radix components for:

```text
Select
DropdownMenu
Popover
Command
Combobox-style controls
```

Ensure their surfaces use:

```text
surface
line
ink
muted
accent
```

Avoid mismatched white/black popup surfaces.

---

# 28. Skeletons

Skeleton loading states should use Mila's subtle surface/muted colors.

Do not create default gray skeletons that conflict with the application palette.

Use the existing design tokens.

---

# 29. Tooltips

Tooltips should match Mila.

For example:

```text
background → ink or suitable elevated surface
foreground → readable contrasting token
```

Inspect the current theme and choose the appropriate existing treatment.

---

# 30. Shared Typography Components

If there is extensive duplicated typography styling, create or improve a small reusable typography primitive.

For example:

```text
src/components/ui/typography.tsx
```

Potential API:

```tsx
<Heading as="h1" size="page">
  Style Profile
</Heading>
```

```tsx
<Text variant="muted">Personalized recommendations based on your profile.</Text>
```

The generated HTML must remain semantic.

For example:

```tsx
<Heading as="h2">
```

must render:

```html
<h2></h2>
```

not:

```html
<div></div>
```

Do not introduce this abstraction unless it meaningfully reduces duplication.

---

# 31. Typography Scale

Create or standardize a predictable hierarchy.

Suggested conceptual roles:

```text
Page title
Section title
Subsection title
Card title
Body
Body small
Label
Caption
Metadata
Muted
```

Use Mila's existing size scale where possible.

Do not dramatically enlarge typography.

The app should still look like Mila after the refactor.

---

# 32. Recommended Font Weights

With Poppins:

```text
400
Body copy

500
Navigation
Buttons
Labels
Compact UI

600
Most headings
Card titles
Section titles

700
Rare strong emphasis
```

Avoid making everything bold.

---

# 33. Letter Spacing

Poppins does not require excessive letter spacing.

Review usage of:

```text
tracking-wide
tracking-wider
tracking-widest
```

Keep wide tracking only when it serves a deliberate design purpose, such as small uppercase labels.

Headings should generally use:

```text
tracking-normal
```

or:

```text
tracking-tight
```

when visually appropriate.

---

# 34. Line Heights

Changing to Poppins may affect vertical dimensions.

Review:

- heading line-height;
- body line-height;
- buttons;
- inputs;
- badges;
- cards;
- modals;
- navigation.

Avoid text clipping or vertically misaligned controls.

---

# 35. Theme Matching Example

If Mila's design currently uses something conceptually like:

```css
--canvas: ... --surface: ... --ink: ... --muted: ... --accent: ... --accent-soft: ... --line: ...;
```

do not change a shadcn Card into:

```tsx
<Card className="border-zinc-200 bg-white text-zinc-950">
```

Instead use:

```tsx
<Card className="border-line bg-surface text-ink">
```

or make those styles part of the shared `Card` primitive itself.

Consumers should not need to repeatedly specify the theme manually.

---

# 36. The Shared Component Should Own Its Theme

Prefer:

```tsx
<Card>
```

instead of:

```tsx
<Card className="border-line bg-surface text-ink">
```

everywhere.

If every card requires those styles, put them in:

```text
src/components/ui/card.tsx
```

Likewise:

```text
Button
Input
Dialog
Badge
Tabs
Select
Popover
Dropdown
Skeleton
```

should already be themed correctly by default.

This keeps Mila's visual system centralized.

---

# 37. Dark Mode

All shadcn components must work correctly with Mila's existing dark theme.

Do not add component-specific hardcoded:

```text
dark:bg-black
dark:text-white
```

unless that is genuinely how Mila's theme works.

Prefer semantic variables whose values change under:

```css
.dark
```

The same component class should ideally work in both themes.

---

# 38. Responsive Behavior

Do not break:

```text
mobile
tablet
desktop
```

layouts.

Check:

- headers;
- dialogs;
- forms;
- cards;
- buttons;
- tabs;
- dropdowns;
- navigation;
- page headings;
- long Poppins text;
- small screen wrapping.

---

# 39. Radix Accessibility

shadcn is built on Radix for many components.

Preserve Radix behavior.

Do not remove or bypass:

- focus traps;
- keyboard navigation;
- `aria-*` relationships;
- dialog titles;
- dialog descriptions;
- labels;
- menu semantics;
- accordion semantics.

Use native semantics and Radix semantics instead of manually recreating accessibility behavior.

---

# 40. Details and Summary

For genuinely simple expandable informational content, native:

```tsx
<details>
  <summary>Why Mila needs this</summary>

  <p>Mila uses this information to improve recommendations.</p>
</details>
```

is acceptable.

For application accordions requiring advanced behavior, use shadcn/Radix Accordion.

Choose based on functionality rather than forcing one approach.

---

# 41. Do Not Blindly Convert Everything to shadcn

Do not replace a custom component merely because shadcn has something similarly named.

If the existing Mila component is:

- well designed;
- accessible;
- theme-aware;
- reusable;
- better suited to the product;

keep it.

The goal is to **standardize primitives**, not destroy good custom product UI.

---

# 42. Do Not Change Mila's Layout

Avoid changing:

- page layouts;
- navigation structure;
- card arrangement;
- application flows;
- onboarding flow;
- information architecture.

A component may internally become shadcn-based while retaining approximately the same visual presentation.

---

# 43. Pages to Audit

Audit the full application.

At minimum inspect existing routes covering:

```text
Authentication
Login
Signup
Password recovery

Onboarding
Style profile
Colour analysis
Body analysis

Dashboard / home
Daily recommendations
Outfit
Hair
Makeup

Profile
Settings
Account
Subscription
Credits

Shared navigation
Cards
Forms
Dialogs
Sheets
Dropdowns
Empty states
Error states
Loading states
```

Discover actual routes instead of assuming they all exist.

---

# 44. Shared Components First

If multiple routes use a shared primitive, update the primitive first.

For example:

```text
src/components/ui/button.tsx
src/components/ui/input.tsx
src/components/ui/card.tsx
src/components/ui/dialog.tsx
src/components/ui/label.tsx
```

Then only modify individual consumers when their semantic usage is wrong.

Avoid hundreds of duplicate Tailwind class changes.

---

# 45. Example Final Component Usage

A Mila form should ideally read cleanly:

```tsx
<Card>
  <CardHeader>
    <CardTitle asChild>
      <h2>Choose your occasion</h2>
    </CardTitle>

    <CardDescription>Mila will adapt your recommendation to the occasion.</CardDescription>
  </CardHeader>

  <CardContent>
    <div className="space-y-2">
      <Label htmlFor="occasion">Occasion</Label>

      <Input id="occasion" placeholder="Dinner, work, date night..." />
    </div>
  </CardContent>

  <CardFooter>
    <Button>Generate Look</Button>
  </CardFooter>
</Card>
```

It should automatically inherit:

```text
Poppins
Mila colors
Mila borders
Mila radius
Mila light/dark theme
```

without requiring lots of page-specific overrides.

---

# 46. Avoid This

Do not create pages like:

```tsx
<Card className="bg-white border-gray-200">
  <h2 className="font-poppins text-black">Profile</h2>

  <p className="text-gray-500">...</p>

  <Button className="bg-black text-white">Save</Button>
</Card>
```

That defeats the design system.

---

# 47. Prefer This

Prefer:

```tsx
<Card>
  <CardHeader>
    <CardTitle asChild>
      <h2>Profile</h2>
    </CardTitle>

    <CardDescription>Manage your personal styling profile.</CardDescription>
  </CardHeader>

  <CardFooter>
    <Button>Save</Button>
  </CardFooter>
</Card>
```

The shared primitives should already know how Mila looks.

---

# 48. Existing Architecture Must Remain Untouched

Do not modify unrelated application architecture.

Do NOT change:

```text
Supabase architecture
API contracts
/api/v1 behavior
TanStack Query behavior
server functions
services
authentication
JWT validation
database schema
Gemini
Cloudflare
weather
credits
Paddle
routing behavior
mobile API compatibility
```

Do not touch:

```text
src/routeTree.gen.ts
```

manually.

---

# 49. Path and Code Conventions

Continue following:

```text
React 19
TypeScript
TanStack Start
TanStack Router
TanStack Query
Tailwind CSS v4
shadcn/ui
Radix UI
class-variance-authority
cn()
Lucide icons
@/* path aliases
```

For icons:

use Lucide imports by name.

Do not introduce another icon library.

---

# 50. Validation

After implementing the changes run:

```bash
bun run format
bun run lint
bun run typecheck
bun test
bun run build
```

Fix issues introduced by the refactor.

Do not bypass errors using:

```text
any
@ts-ignore
eslint-disable
```

unless there is an existing documented reason.

---

# 51. Visual Review

After converting the font and standardizing shadcn components, visually inspect the application.

Check:

```text
Poppins loaded everywhere
No old font remains
No default shadcn gray/black theme leaked in
Cards match Mila
Buttons match Mila
Inputs match Mila
Dialogs match Mila
Dropdowns match Mila
Badges match Mila
Tabs match Mila
Skeletons match Mila
Light mode matches existing website
Dark mode matches existing website
```

Also check:

```text
text clipping
wrapping
button width
input height
navigation alignment
card heights
modal sizing
mobile overflow
desktop spacing
```

---

# 52. Final Desired Architecture

The resulting design system should conceptually work like:

```text
Mila Theme Tokens
       ↓
Tailwind CSS v4 @theme
       ↓
Poppins Global Typography
       ↓
shadcn/ui + Radix Primitives
       ↓
Mila-Themed Shared Components
       ↓
Semantic HTML
       ↓
Pages / Features
```

Not:

```text
shadcn default theme
       ↓
random page overrides
       ↓
hardcoded colors
       ↓
inconsistent Mila UI
```

---

# 53. Final Result

The final application should feel like:

**Mila's existing design system, powered by shadcn/ui.**

Not:

**a default shadcn template with Mila functionality inside it.**

The visual result should retain Mila's existing identity while gaining:

- Poppins typography;
- better semantic HTML;
- more accessible structure;
- standardized shadcn primitives;
- reusable variants;
- consistent forms;
- consistent cards;
- consistent dialogs;
- consistent buttons;
- centralized theme styling;
- better maintainability.

---

# 54. Final Report

After completing the task, provide a concise report.

## Font

State:

- how Poppins was loaded;
- which weights are included;
- where it is configured globally;
- which old font configuration was removed.

## Theme

State:

- which existing Mila theme tokens were preserved;
- how shadcn components were mapped to the Mila theme;
- whether any additional semantic tokens were required.

## shadcn/ui

List which shared components were:

```text
added
updated
reused
```

Do not list unchanged components.

## Semantic HTML

Summarize major semantic improvements, for example:

```text
div → h1
div → h2
span → h3
div → p
custom text → Label
secondary metadata → small
```

Do not dump every changed line.

## Files Changed

List the important files modified.

## Validation

Report results for:

```bash
bun run format
bun run lint
bun run typecheck
bun test
bun run build
```

If any command fails because of a pre-existing unrelated problem, clearly explain that instead of hiding or bypassing it.
