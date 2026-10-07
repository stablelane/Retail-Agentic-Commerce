# Design System Inspired by Matter

> Auto-extracted from `https://matter.askangle.com/` on 2026-10-07

## 1. Visual Theme & Atmosphere

Friendly, approachable design with rounded shapes and generous whitespace.

The hero section leads with "Matter".

**Key Characteristics:**
- Instrument Serif as the heading font (custom web font loaded via @font-face)
- Instrument Sans as the body font for all running text
- Heading weight 400
- Light/white background (#ffffff) as the primary canvas
- Primary accent `#312e81` used for CTAs and brand highlights
- 5 shadow level(s) detected — standard shadows
- Rounded corners (8px+) creating a friendly, approachable feel
- Tags: light, rounded, monochrome, bold-typography, serif

## 2. Color Palette & Roles

### Primary
- **Primary Accent** (`#312e81`) · `--color-primary`: Brand color, CTA backgrounds, link text, interactive highlights.
- **Background** (`#ffffff`) · `--color-bg`: Page background, primary canvas.

### Text
- **Text Primary** (`#000000`) · `--color-text`: Headings and body text.
- **Text Secondary** (`#666666`) · `--color-text-secondary`: Muted text, captions, placeholders.

### Borders & Surfaces
- **Border** (`#f7f7f7`) · `--color-border`: Dividers, outlines, input borders.

### Full Extracted Palette

| # | Hex | CSS Variable | Role | Area | Contrast |
|---|---|---|---|---|---|
| 1 | `#f7f7f7` | `--palette-1` | block | large | text-dark |
| 2 | `#ffffff` | `--palette-2` | badge | large | text-dark |
| 3 | `#312e81` | `--palette-3` | text-accent | large | text-light |
| 4 | `#d0cbff` | `--palette-4` | block | large | text-dark |
| 5 | `#efefef` | `--palette-5` | button | small | text-dark |
| 6 | `#d9d4ff` | `--palette-6` | text-accent | small | text-dark |

## 3. Typography Rules

- **Heading Font:** `Instrument Serif` (web font)
- **Body Font:** `Instrument Sans` (web font)

### Type Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing |
|---|---|---|---|---|---|
| H1 | Instrument Serif | 72px | 400 | 79.2px | normal |
| H2 | Instrument Sans | 18px | 600 | 19.8px | normal |
| H3 | Instrument Sans | 13px | 400 | 16.9px | normal |
| H4 | Instrument Sans | 14px | 500 | 15.4px | normal |
| Body | Instrument Sans | 14px | 400 | 18.2px | normal |

### Type Scale

| Token | Size | Suggested Usage |
|---|---|---|
| Display | `72px` | headings |
| H1 | `48px` | headings |
| H2 | `32px` | headings |
| H3 | `28px` | headings |
| H4 | `24px` | headings |
| Body L | `18px` | body / supporting text |
| Body | `16px` | body / supporting text |
| Small | `14px` | body / supporting text |
| XS | `13.3333px` | body / supporting text |
| Caption | `13px` | body / supporting text |

## 4. Component Stylings

### Primary Button

```css
.btn-primary {
  background: #efefef;
  color: #000000;
  border-radius: 100px;
  padding: 16px 24px;
  font-size: 14px;
  font-weight: 400;
  border: none;
  cursor: pointer;
}
```

### Ghost Button

```css
.btn-ghost {
  background: transparent;
  color: #ffffff;
  border-radius: 0px;
  padding: 0px 0px;
  font-size: 14px;
  font-weight: 600;
  border: none;
  cursor: pointer;
}
```

### Ghost Button 2

```css
.btn-ghost-2 {
  background: transparent;
  color: #000000;
  border-radius: 0px;
  padding: 0px 0px;
  font-size: 14px;
  font-weight: 400;
  border: none;
  cursor: pointer;
}
```

### Filled Button

```css
.btn-filled {
  background: #f5f5f5;
  color: #312e81;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 13px;
  font-weight: 600;
  border: none;
  cursor: pointer;
}
```

### Outline Button

```css
.btn-outline {
  background: transparent;
  color: #000000;
  border-radius: 50px;
  padding: 0px 0px;
  font-size: 14px;
  font-weight: 400;
  border: 1.6px solid rgba(0, 0, 0, 0.15);
  cursor: pointer;
}
```

### Pill Button

```css
.btn-pill {
  background: #312e81;
  color: #ffffff;
  border-radius: 100px;
  padding: 16px 24px;
  font-size: 14px;
  font-weight: 400;
  border: none;
  cursor: pointer;
}
```

### Card

```css
.card {
  background: #f7f7f7;
  border-radius: 6px;
  padding: 0px;
}
```

## 5. Layout Principles

- **Base spacing unit:** `16px` — use multiples (32px, 48px, 64px, etc.)

### Spacing Scale (extracted from real elements)

| Token | Value | Role |
|---|---|---|
| spacing-1 | `16px` | element |
| spacing-2 | `4px` | element |
| spacing-3 | `12px` | element |
| spacing-4 | `11.2px` | element |
| spacing-5 | `8px` | element |
| spacing-6 | `20px` | element |
| spacing-7 | `1px` | element |
| spacing-8 | `36px` | card |

### Border Radius Scale

| Token | Value | Element |
|---|---|---|
| radius-button | `8px` | button |
| radius-card | `50px` | card |
| radius-button | `10px` | button |
| radius-button | `6px` | button |
| radius-pill | `100px` | pill |

## 6. Depth & Elevation

| Level | Shadow | Usage |
|---|---|---|
| Low | `rgb(49, 46, 129) 0px 0px 0px 0px inset` | Cards, subtle elevation |
| Low | `rgb(0, 0, 0) 0px 0px 0px 0px inset` | Cards, subtle elevation |
| High | `rgba(0, 0, 0, 0.15) 0px 4px 20px 0px` | Modals, floating elements |
| Low | `rgb(255, 255, 255) 0px 0px 0px 0px inset` | Cards, subtle elevation |
| Deep | `rgba(0, 0, 0, 0.15) 0px 5px 30px 0px` | Hero sections, deep layers |


## 7. Do's and Don'ts

### Do
- Use `#ffffff` as the primary background color
- Use `Instrument Serif` for all headings and `Instrument Sans` for body text
- Use `#312e81` as the single dominant accent/CTA color
- Maintain `16px` as the base spacing unit — all gaps should be multiples
- Use rounded corners (`8px`+) consistently for all interactive elements
- Use serif fonts for headlines to maintain editorial authority
- Make headlines large and bold — typography is the hero element
- Stick to grayscale + `#312e81` accent — avoid color overload
- Apply the shadow system for elevation — use the extracted shadow values
- Use weight 400 for headings to match the brand's typographic voice

### Don't
- Don't use colors outside the extracted palette without justification
- Don't substitute Instrument Serif/Instrument Sans with generic alternatives
- Don't use irregular spacing — stick to 16px grid
- Don't use dark/black backgrounds — this is a light-themed design
- Don't use sharp corners — they feel hostile in this rounded design language
- Don't add additional saturated colors beyond the primary accent
- Don't mix in geometric sans-serif headlines — it breaks the editorial tone
- Don't use pure black (#000000) for text — use `#000000` instead
- Don't add decorative elements not present in the original design — no badges, ribbons, banners, or ornaments unless the source site uses them
- Don't invent UI patterns the source site doesn't have — if the original has no NEW badge, don't add one just because a red is in the palette

## 8. Responsive Behavior

| Breakpoint | Width | Notes |
|---|---|---|
| Mobile | < 640px | Single column, stack sections, reduce font sizes ~80% |
| Tablet | 640–1024px | 2-column where appropriate, maintain spacing ratios |
| Desktop | 1024–1440px | Full layout as designed |
| Wide | > 1440px | Max-width container, center content |

- Touch targets: minimum 44×44px on mobile
- Maintain 16px base unit across breakpoints — only scale multipliers

## 9. Agent Prompt Guide

### Quick Color Reference

```
Background:  #ffffff
Text:        #000000
Accent:      #312e81
Border:      #f7f7f7
```

### Example Prompts

1. "Build a hero section with a `#ffffff` background, `Instrument Serif` heading in `#000000`, and a `#312e81` CTA button with 100px radius."
2. "Create a pricing card using background `#ffffff`, border `#f7f7f7`, `Instrument Sans` for text, and 48px padding."
3. "Design a navigation bar — `#ffffff` background, `#000000` links, `#312e81` for active state."
4. "Build a feature grid with 3 columns, 48px gap, each card using the card component style."
5. "Create a footer with `#000000` background, `#ffffff` text, and 32px padding."

### Iteration Guide

1. Start with layout structure (sections, grid, spacing)
2. Apply colors from the palette — background first, then text, then accents
3. Set typography — font families, sizes from the type scale, weights
4. Add components — buttons, cards, inputs using the specs above
5. Apply border-radius consistently across all elements
6. Add shadows for depth — use the extracted shadow values, not defaults
7. Check responsive behavior — test mobile and tablet layouts
8. Final pass — verify all colors match, spacing is consistent, fonts are correct

## 10. CSS Custom Properties

> 21 custom properties extracted from `:root` / `html` stylesheets.

### Spacing Variables

| Variable | Value |
|---|---|
| `--hover-lift-amount` | `4px` |
| `--hover-scale-amount` | `1.03` |
| `--hover-subtle-zoom-amount` | `1.015` |
| `--sidebar-width` | `25rem` |
| `--narrow-content-width` | `36rem` |
| `--normal-content-width` | `42rem` |
| `--wide-content-width` | `46rem` |
| `--narrow-page-width` | `90rem` |
| `--normal-page-width` | `120rem` |
| `--wide-page-width` | `150rem` |
| `--section-height-small` | `15rem` |
| `--section-height-medium` | `25rem` |
| `--section-height-large` | `35rem` |

### Typography Variables

| Variable | Value |
|---|---|
| `--text-align-default` | `left` |

### Other Variables

| Variable | Value |
|---|---|
| `--hover-shadow-color` | `var(--color-shadow)` |
| `--hover-transition-duration` | `.25s` |
| `--hover-transition-timing` | `ease-out` |
| `--surface-transition-duration` | `.3s` |
| `--surface-transition-timing` | `var(--ease-out-quad)` |
| `--submenu-animation-speed` | `.36s` |
| `--submenu-animation-easing` | `cubic-bezier(.25, .1, .25, 1)` |
