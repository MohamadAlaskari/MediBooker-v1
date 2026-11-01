---
name: react-web-feature
description: Recipe and conventions for building features in the MediBooker v2 web app (apps/web, Next.js App Router), which contains the public practice page, the patient portal and the practice dashboard — folder structure, routing and role guards, data fetching with the generated API client and TanStack Query, realtime cache invalidation, forms with validation and server errors, design-token styling, i18n, accessibility, UI states and tests. Use for any web UI work.
---

# React web feature recipe

Framework: **Next.js with the App Router** (ADR 0003), self-hosted as a Node.js container. The public practice page is server-rendered and cached; portal and dashboard are signed-in client areas that are never cached.

## Structure

```
apps/web/
  middleware.ts               locale (ar default, en), CSP nonce, sign-in redirect for (patient) and (practice)
  app/
    [locale]/
      layout.tsx              <html lang dir>, practice theme (--brand-*) and fonts, set on the server
      (public)/[slug]/        public practice page: server component, generateMetadata with hreflang, JSON-LD;
                              free times refreshed on the client (30–60 s); reserved slugs blocked
      (patient)/              portal: appointments, book, record, family, settings (sign-in required)
      (practice)/practice/    dashboard (roles STAFF, DOCTOR, ADMIN); realtime client
    sitemap.ts, robots.ts
  src/
    providers/                QueryClient, i18n, theme, auth (client providers)
    features/<feature>/
      components/             feature-specific components
      hooks/                  wrappers around generated query hooks (useBookAppointment, ...)
      schemas.ts              zod schemas for forms
      <feature>.test.tsx
    components/ui/            design-system components (same names and props as in Figma)
    lib/                      API client setup, realtime client, date and format helpers
    styles/                   tokens.css (generated), globals.css
    locales/ar/*.json, locales/en/*.json   (Arabic is the default; more locales later)
```

Server components fetch only public data (the practice page). Everything with personal or health data runs in client components through the generated API client, with `no-store`; never pass tokens or health data through server-component props.

## Rules

1. **Design system first.** Build screens from `components/ui`. Names and props mirror Figma, for example `<Button variant="primary" size="large" loading>`. If a component is missing, build it in `components/ui` from the Figma spec, not inline in a feature. Style only with token CSS variables or token-based utility classes; no raw hex values or magic pixel numbers.
2. **Data.** Use the generated hooks from `@medibooker/api-client` and their query keys. After a mutation, invalidate the affected queries. Show errors by translating the server `code` (`errors.SLOT_NOT_AVAILABLE`).
3. **Realtime (dashboard).** One socket connection per session (`lib/realtime.ts`). On `appointment.*` and `slots.changed`, invalidate the matching queries. Announce new bookings with a toast inside an `aria-live="polite"` region. Payloads contain IDs only; fetch details through the API.
4. **Forms.** react-hook-form + zod. Share schemas with mobile where possible (`packages/validation`). Map problem+json `errors[]` to the fields. Disable submit while pending, prevent double submits, send an `Idempotency-Key` for bookings.
5. **Auth.** Cookie-based; the app never reads tokens. Route guards check the role. The login redirect keeps the return path (no personal data in URLs). The staff dashboard logs out after inactivity (default 15 minutes) with a warning dialog first.
6. **States.** Every data view renders loading (skeleton), empty (Empty State component with the next action), error (message and retry) and success. Optimistic updates only where rollback is trivial, never for booking.
7. **i18n and formatting.** All copy through i18next keys `feature.screen.element` with ICU plurals. Arabic is the default, English the fallback; adding a locale needs only a new `locales/<code>` folder. Set `<html lang dir>` from the active locale. Dates, times and numbers only through helpers in `lib/format.ts` (`Intl` with the active locale, the practice time zone, the configured `numberingSystem` and `hourCycle`). Never concatenate translated fragments.
7a. **RTL.** Use CSS logical properties only (`margin-inline-start`, `padding-inline`, `inset-inline-end`, `text-align: start`; Tailwind `ms-* me-* ps-* pe-* start-* end-* text-start`). Use `rtl:` variants only for real exceptions. Mirror directional icons (chevrons, arrows, back/forward, log-out) via an `Icon` prop; never mirror clocks, check marks, media controls or the logo. Wrap LTR snippets inside Arabic text (e-mail, phone, IDs, Latin names) in `<bdi>`; phone numbers and security-code inputs get `dir="ltr"`. Follow the bidi table in `design-system` (Latin token last in Arabic strings, `←` for "from → to"). Run every Playwright flow in `ar` (RTL) and `en` (LTR).
7b. **Practice theme and breakpoints.** Brand colours come only from the `--color-*` tokens; the practice theme sets `--brand-50 … --brand-950` on the root, rendered on the server with the page (no flash of the default theme). Never compute or hard-code a brand colour in a component; status colours are fixed (ADR 0002). Breakpoints from `design-system`: phone below 744 px, tablet 744–1279 px (compact header), desktop from 1280 px.
7c. **Public practice page.** The `(public)` route group has no auth, sets no cookies and loads no third-party scripts, fonts or maps. Server-rendered, one URL per locale with `hreflang`, `schema.org/MedicalClinic` structured data, data only from `GET /public/practices/{slug}`, `GET /availability` and `GET /slots`. "Book appointment" and the service cards scroll to the free times; choosing a time leads to sign-in with a return path that carries only IDs (service, slot), then to the review step.
8. **Accessibility.** Semantic HTML first. Use accessible headless primitives (for example Radix UI or React Aria) for dialog, menu, popover, tabs and date picker. Visible focus ring from the `border/focus` token. Keyboard navigation for the slot grid and the calendar (arrow keys). Move focus to the page heading on route change. Respect `prefers-reduced-motion`. Check with axe.
9. **Security.** No tokens or personal data in `localStorage` or `sessionStorage`. No `dangerouslySetInnerHTML`. CSP-safe code. No third-party trackers. Mask insurance numbers.
10. **Performance.** Code splitting per route. Virtualize long lists in the dashboard. Size and lazy-load images.

## Tests

- Vitest + Testing Library for components and hooks; MSW for API mocks, typed from the OpenAPI types.
- Playwright e2e for the main flows (patient books and cancels; staff checks a patient in and generates slots), with `@axe-core/playwright` on every page.
- Query elements by role and label, not by CSS selectors.

## Checklist

- [ ] Matches the Figma frames (links in the handoff) in light and dark mode; all states present
- [ ] Only design-system components and tokens; no hard-coded colours or sizes
- [ ] Strings in `ar` and `en`; layout checked in RTL and LTR; dates/times in the practice time zone
- [ ] Keyboard-only and screen-reader pass; axe clean
- [ ] Errors mapped from `code`; double submit prevented
- [ ] Lint, typecheck, unit and e2e tests green (commands and results in the handoff)
