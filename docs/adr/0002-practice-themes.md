# 0002. Practice themes: brand colour layer with presets and a checked custom colour
Status: Accepted — 2026-11-01 (the client confirmed: any colour with automatic contrast adjustment, and the theme also in the dashboard)

## Context

The client wants every clinic to personalise its colours in the settings: either choose one of several prepared themes or set its own colour (2026-11-01). At the same time the non-negotiables apply: colours only from design tokens, WCAG 2.2 AA contrast, light and dark mode, Arabic RTL and English LTR. Status colours (red = cancelled or error, amber = warning, green = done) carry meaning for patients and must stay recognisable. Clinics also get a public practice page (no sign-in), which should look like the clinic.

## Decision

1. **Token layers:** `Primitives` → `Brand` → `Color`. The `Brand` collection has the steps `brand/50 … brand/950` and one mode per preset: **Teal (default)**, Ocean, Indigo, Violet, Graphite. Only nine semantic colours point to the brand layer: `color/bg/brand`, `-hover`, `-pressed`, `-subtle`, `-muted`, `color/text/brand`, `color/border/brand`, `color/border/focus`, `color/icon/brand` (light uses 600/700/800/50/100, dark uses 400/300/200/950/900). Neutral and status colours stay fixed.
2. **Presets are pre-checked** for contrast in light and dark (button text on `brand/600` and `brand/400`, links, text on tinted backgrounds, focus ring). Measured over all presets in light and dark: button text 5.2–7.6 : 1, links 6.7–9.5 : 1, focus ring at least 4.9 : 1 against the canvas (table in the `design-system` skill).
3. **Custom colour:** the admin enters a hex value. The server generates the eleven steps (OKLCH, same lightness targets as the presets), checks the same contrast pairs and darkens or lightens steps until they pass. The response says whether the colour was adjusted, and the settings screen shows the result before saving.
4. **Scope:** the theme applies to the clinic's patient app session, patient portal, public practice page, e-mails and clinic dashboard. The MediBooker product logo and operating-system mock-ups (push previews) stay teal; in Figma they are pinned to the Teal mode.
5. **Logo:** optional upload (PNG or WebP, at least 256 × 256 px, at most 1 MB, re-encoded and virus-scanned). Without a logo the clinic's initials are shown on the brand colour ("Practice Mark").
6. **Runtime:** web sets the CSS variables `--brand-50 … --brand-950` on the root, rendered on the server so there is no flash of the default theme; the app gets the theme with the practice configuration and caches it; e-mails use the generated values as inline styles at send time.

## Consequences

Positive: clinics get their own look without breaking contrast or status meaning; one design system and one component library for every clinic; designers can preview any preset by switching the `Brand` mode of a frame.
Negative: more combinations to test (presets × light/dark × RTL/LTR); a custom colour may be adjusted and look slightly different from the clinic's brand book; caches must be invalidated when the theme changes.
Follow-ups: contrast generator and its unit tests in `packages/design-tokens`; visual regression tests for one non-default preset; token export must include the `Brand` collection; the Next.js server sets the theme variables per request (ADR 0003).

## Alternatives considered

- Free colour pickers for many tokens: maximum freedom, but contrast and status colours can break and support cost grows.
- Presets only: simplest and always accessible, but the client asked for own colours as well.
- One white-label build per clinic: full control, but slow releases and one store listing per clinic.
