# Web (Next.js)

`apps/web` (`@medibooker/web`) serves the public practice page, the patient portal and the practice dashboard. It follows the `react-web-feature` skill and the decisions in [ADR 0003](../adr/0003-web-framework-nextjs.md) (Next.js), [ADR 0007](../adr/0007-web-ui-shadcn.md) (shadcn/ui on React Aria) and [ADR 0008](../adr/0008-animation-gsap.md) (GSAP). The web never talks to a database; it reaches practice data only through the API, which routes each request to the practice's own database ([ADR 0005](../adr/0005-multi-tenancy.md)).

## 1. Stack

- Next.js 16.4 App Router with Turbopack, React 19.3.0 with the React Compiler (`babel-plugin-react-compiler` 1.0.0), self-hosted as a standalone Node container.
- UI: shadcn/ui components initialised with `--base aria --rtl` (React Aria Components underneath), Tailwind CSS 4.3, sonner toasts, lucide-react icons.
- Motion: GSAP 3.15 and `@gsap/react` 2.1; CSS transitions for simple states and for the open/close of primitives.
- Data: the generated client `@medibooker/api-client` with TanStack Query; forms with react-hook-form and the generated zod schemas.

## 2. Structure

```text
apps/web/
  components.json               shadcn CLI configuration
  next.config.ts · postcss.config.mjs · vitest.config.ts · playwright.config.ts · eslint.config.js
  Dockerfile · .env.example
  src/
    proxy.ts                    CSP nonce and locale routing; auth redirects from A05
    instrumentation.ts          fail-fast check of the server environment
    app/                        routes (§5)
    components/ui/              shadcn components, managed with the CLI, adapted to Figma
    features/<feature>/         components/, hooks/, schemas.ts, index.ts
    i18n/                       routing.ts, request.ts, navigation.ts (binding per decision D1)
    lib/                        api.server.ts, api.client.ts, errors.ts, format.ts, csp.ts,
                                safe-return-path.ts, brand-style.ts, utils.ts (cn)
    lib/motion/                 gsap.ts, inline-x.ts, use-motion.ts
    providers/                  app-providers.tsx
    styles/                     globals.css, theme.css
    generated/                  csp-hashes.ts (X07, committed)
  e2e/                          Playwright specs, support/fixtures.ts
  test/                         setup.ts, render.tsx, empty.ts
```

Server environment: `API_INTERNAL_URL`, `PUBLIC_SITE_URL`, `APP_ENV`, validated in `instrumentation.ts`. There are no `NEXT_PUBLIC_*` variables: one image serves every environment.

## 3. next.config.ts

- `output: 'standalone'`, `outputFileTracingRoot: path.join(import.meta.dirname, '../..')`.
- `transpilePackages: ['@medibooker/api-client']`, `reactCompiler: true`, `poweredByHeader: false`, `reactStrictMode: true`.
- `headers()` returns the same static headers for every route and reads no `process.env`, because Next writes them into `routes-manifest.json` at build time:

  | Header | Value |
  |---|---|
  | `Strict-Transport-Security` | `max-age=31536000` (browsers ignore it over plain HTTP; `includeSubDomains` and `preload` are decided at the edge in OPS01) |
  | `Cross-Origin-Opener-Policy` | `same-origin` |
  | `X-Content-Type-Options` | `nosniff` |
  | `Referrer-Policy` | `strict-origin-when-cross-origin` |
  | `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

  A unit test asserts that `headers()` returns identical output under different `APP_ENV` values. Anything environment-dependent runs in `proxy.ts`, which executes per request.
- In `next dev` only, a rewrite sends `/api/v1/:path*` to `API_INTERNAL_URL`, so local development is same-origin like production.
- With decision D1 option B, the config is wrapped with next-intl's plugin.

## 4. proxy.ts and the Content Security Policy

`src/proxy.ts` (the Next 16 name for middleware) runs on every page request:

1. Creates a nonce and the policy with the pure, unit-tested `buildCsp(nonce, { dev })` from `lib/csp.ts`:

   | Directive | Production | Development |
   |---|---|---|
   | `default-src` | `'self'` | same |
   | `script-src` | `'self' 'nonce-…' 'strict-dynamic'` | adds `'unsafe-eval'` |
   | `style-src` | `'self' 'nonce-…' 'sha256-…'` (sonner's stylesheet) | `'self' 'unsafe-inline'` (style hot reloading has no nonce) |
   | `style-src-attr` | `'unsafe-inline'` (server-rendered `style` attributes from React Aria positioning and CSS variables) | same |
   | `img-src` · `font-src` · `connect-src` | `'self' data: blob:` · `'self'` · `'self'` | same |
   | `object-src` · `base-uri` · `form-action` · `frame-ancestors` | `'none'` · `'none'` · `'self'` · `'none'` | same |

2. Sets the policy on the response and forwards it, with `x-nonce`, as request headers, so Next applies the nonce to its own scripts and the layout to the brand `<style>`.
3. Locale routing: F06 redirects paths without a locale prefix using `negotiateLocale(Accept-Language)`; X06 composes the i18n library's middleware. The e2e check "no CSP violations" proves the nonce survives the composition.
4. The matcher excludes `/api/`, `/_next/`, `/healthz` and files at the top level by extension, so `/apifoo`, `/en/foo.bar` and `/en/x.png` are pages with the policy and a 404. A folder under `public/` needs its own exclusion.

GSAP and React write styles through the CSSOM (`element.style`), which this policy allows. sonner 2.0.8 injects one fixed `<style>` element at load time without a nonce. X07 adds `pnpm --filter @medibooker/web generate`, which reads that stylesheet from the installed sonner, computes its SHA-256 and writes `src/generated/csp-hashes.ts` (committed and drift-checked); `buildCsp` adds the hash to `style-src`. A sonner update regenerates it, and the e2e check covers a page with a toast. If this proves brittle, the fallback is `pnpm patch sonner` to import `sonner/dist/styles.css` instead of injecting it.

## 5. Routes

| Route | Purpose | Data and caching |
|---|---|---|
| `[locale]/layout.tsx` | `hasLocale` / `notFound`; `<html lang dir data-theme data-brand>` rendered on the server; fonts; providers; skip link; a nonce'd brand `<style>` for a custom practice colour (§9) | dynamic (nonce) |
| `[locale]/page.tsx` | Neutral platform landing until a design exists | none |
| `[locale]/` | In an installation (ADR 0016) the page of its practice, `PRACTICE_SLUG`; without one a neutral page | as the practice page |
| `[locale]/(public)/[slug]/` | Practice page PW13/PW14 (P03), with the way to sign in or sign up instead of the free times since B07 (D19); no cookies, no third parties; the installation's own practice leads to `[locale]/` with 308 | server fetch with `no-store`; not cached (decision D2) |
| `[locale]/(auth)/` | The ways in, for someone without a session: sign-in, the first step of sign-up, verification, reset, two-factor (A05) | client only, `no-store` |
| `[locale]/(patient)/` | The account of a signed-in person, with the steps of a sign-up after its first (details, check inbox) | client only, `no-store` |
| `[locale]/(portal)/` | The home (PW2, B06), where a sign-in without a way back lands, appointments and booking (B04), in a frame with navigation and signing out | client only, `no-store` |
| `[locale]/(practice)/` | Practice dashboard: roles, 15-minute inactivity logout with a warning, realtime from RT01 | client only, `no-store` |
| `[locale]/dev/kit/` | Component overview (X07); `notFound()` when `APP_ENV=production` | `force-dynamic` |
| `global-error.tsx` | Static bilingual message with its own `<html lang="ar" dir="rtl">` | none |
| `healthz/route.ts` | Container probe | `force-dynamic`, no data |
| `sitemap.ts` · `robots.ts` | Sitemap from `GET /public/practices` (published slugs, read only from the platform database); robots disallows portal and dashboard | `export const dynamic = 'force-dynamic'`, so `PUBLIC_SITE_URL` is read at run time |

- Every page but the start page and a practice's has a title of its own, through `pageTitle` (`lib/page-title.ts`): a page is a new document, and its title is what a screen reader announces on arrival (WCAG 2.4.2). A fixed text of the page and never a service or a practice, because a title stays in the browser's history.
- Every static first segment under `[locale]` is on the API's reserved-slug list (unit test in P02).
- Portal and dashboard routes carry the practice id, so each browser tab works in one practice and every API call names it in the path (ADR 0005 §3). The exact segments are designed in A05 together with decision D3 (page address).
- A retired slug: the API answers with the practice and its current slug, and the page calls `permanentRedirect()` (308) to the current URL. An unpublished or offboarded practice answers 404 like an unknown slug.
- A practice whose database is unavailable answers 503 for that practice only; pages show the error state with a retry and the request id, other practices keep working.

## 6. Providers

`providers/app-providers.tsx` (client component), outermost first:

1. The i18n client provider with only the namespaces the subtree needs; practice subtrees nest a second provider with the practice's `timeZone` (§8).
2. `QueryClientProvider` with `createQueryClient()`; `MutationCache.onError` shows a toast unless the mutation sets `meta.handlesError`. As built, without the toast so far: the frames of `(patient)` and `(portal)` pass `onUnauthenticated`, so that the code `UNAUTHENTICATED` on any query or press is a `location.replace` to sign-in, with the current path as `next`, or the safe `next` the fragment already holds. `(auth)` and a public page pass nothing, so a page of signed-in people belongs in one of those two groups. All three frames set React Aria's `I18nProvider` to the page's locale, and the public picker does so for itself: otherwise a dialog's hidden dismiss button and the arrow keys of tabs follow the browser's language.
3. sonner's `<Toaster />`, placed by reading direction, announcing through an `aria-live="polite"` region.

`data-theme` is `light`, `dark` or `system` (default). An explicit choice from the portal or dashboard settings (A05) is stored in a `theme` cookie that only signed-in areas set, so the server renders the right value without a flash. As built (B06): the account page sets it (`AppearanceSetting`: `Path=/`, a year, `SameSite=Lax`, `Secure` over HTTPS), and the root layout reads it through `themeOf` (`lib/theme.ts`), which lets only the three values reach the attribute. `data-brand` carries the practice's preset on practice-scoped pages.

## 7. API client and data

- **`lib/api.server.ts`** (`import 'server-only'`): `configureApiClient({ baseUrl: API_INTERNAL_URL })`. Public endpoints only, `cache: 'no-store'`, `Accept-Language` = route locale. It forwards the incoming `X-Forwarded-For` unchanged, so the API, which trusts one proxy hop, throttles per visitor and not per web container. An API 404 becomes `notFound()`.
- **`lib/api.client.ts`:** `baseUrl: ''`, `credentials: 'same-origin'`; `getHeaders` adds `Accept-Language` and the CSRF header; a 401 outside the auth routes gets one refresh and one new try, one refresh for all requests at that moment. A failed refresh may have lost to another tab's, and nothing orders the two answers, so when `mb_csrf` is unchanged it waits 500 ms and reads the cookie once more; a changed cookie means that the session is alive. Only generated hooks; no handwritten `fetch`. The practice is part of every generated path, so query keys of two practices never collide.
- **Free times (P06, B07):** on the booking page, signed in; the generated hooks poll every 45 s, and the API answers `no-store`.
- **Server components fetch only public data.** Personal and health data never pass through server-component props.
- **Tokens and hand-offs in URLs:** links from e-mails carry tokens in the fragment (`/ar/verify-email#token=…`; invitations also carry the practice id, `#practice=…&token=…`); the page reads them and POSTs them in the body. The way from the practice page through signing in to the booking page also uses the fragment (`#next=/{locale}/book/{slug}`), and names only that page: a URL stays in the browser's history, so the chosen service, doctor and time stay out of it; since B07 they are chosen after signing in and stay in the page's memory. Neither reaches server logs or a `Referer`. The skip link must not wipe such a fragment, so when it holds an `=` the link only moves the focus.
- **`safeReturnPath(next)`** (P06, `lib/safe-return-path.ts`): accepts only `/<locale>/[a-z0-9/-]*`, with no query; rejects `//`, `\`, encoded slashes, URL schemes and anything longer than 512 characters. The language switch keeps the fragment, so `useReturnPath` puts the page's own locale into the path.

## 8. i18n and RTL

The catalogue, bidi rules and formatting helpers are shared ([05](05-errors-i18n-tokens.md)). The binding to Next.js depends on decision D1:

- **Option B (chosen, ADR 0013): next-intl 4.14.9.** As built: the language comes from `next/root-params`; `src/proxy.ts` keeps its own redirect instead of next-intl's middleware; `routing.ts` and `navigation.ts` wait for the first client-side navigation (A05).
  - `src/i18n/routing.ts`: `defineRouting({ locales: LOCALES, defaultLocale: 'ar', localePrefix: 'always', localeCookie: false, alternateLinks: true })`; public pages stay cookie-free.
  - `src/i18n/request.ts`: messages and named formats from `@medibooker/i18n`, `timeZone: 'UTC'`.
  - `src/i18n/navigation.ts`: `createNavigation(routing)`; typed keys through the `AppConfig` augmentation.
- **Option A: i18next.** Per-request instances in server components, `react-i18next` in client components, the same catalogue; `proxy.ts` implements the same locale routing.

Either way:

- The practice time zone is never global: server code formats through `formatInPracticeZone(practice)`; client subtrees of a practice nest a provider with `timeZone={practice.timeZone}`.
- Dates, times and numbers go through `lib/format.ts`, which uses `toFormattingLocale(locale, { numberingSystem, hourCycle })`.
- Async pages only fetch and pass data; the content lives in synchronous components that use the translation and format hooks, which component tests can render.
- RTL: `<html lang dir>` is rendered on the server; logical utilities only (lint); `rtl:` variants only for real exceptions; shadcn's RTL mode converts classes and flips directional icons; icons sit at `data-icon="inline-start"` or `"inline-end"`; user-supplied text in `<bdi>`; phone and code inputs with `dir="ltr"`.

## 9. Styling: tokens, Tailwind and shadcn/ui

- `src/styles/globals.css`:

  ```css
  @import 'tailwindcss';
  @import 'tw-animate-css';
  @import '@medibooker/design-tokens/tokens.css';
  @import './theme.css';
  ```

  plus a base layer: `body` with the canvas and primary text tokens, focus ring `outline-2 outline-border-focus outline-offset-2`.
- `tokens.css` resets Tailwind's default palette, spacing, radius, text and breakpoint scales, so only token utilities exist (`bg-bg-canvas`, `p-4` = 16 px, `tablet` 744 px, `desktop` 1280 px).
- `components.json`: base `aria`, `"rtl": true`, `tailwind.css: "src/styles/globals.css"`, `cssVariables: true`, aliases `@/components/ui` and `@/lib/utils`, icon library lucide. Components are added and updated only with the shadcn CLI, an exact-pinned devDependency of `apps/web` from the catalog, run as `pnpm --filter @medibooker/web exec shadcn …` (so pnpm's release-age gate and the lockfile apply to it), with `--dry-run` / `--diff` before an update (ADR 0007).
- `src/styles/theme.css` maps shadcn's variables to semantic tokens (table in ADR 0007), contains no raw colour values and redefines the `dark` variant for the three `data-theme` values:

  ```css
  @custom-variant dark {
    &:where([data-theme='dark'], [data-theme='dark'] *) {
      @slot;
    }
    @media (prefers-color-scheme: dark) {
      &:where([data-theme='system'], [data-theme='system'] *) {
        @slot;
      }
    }
  }
  ```

- Variants and sizes follow the Figma components, not shadcn's defaults: touch targets of at least 44 × 44 px, the Arabic and English type scales, the `border/focus` ring.
- `outline-none` never stands beside a ring: in Tailwind 4 it sets `--tw-outline-style`, which `outline-2` reads, so the ring stays invisible, and axe does not see that. It stays only on what a script alone focuses (a heading with `tabIndex={-1}`, a dialog, a list box) and on the input of a password field, whose group draws the ring.
- A running request is `isPending` on the button, with its `data-[pending]` look, and not `isDisabled`, which would drop the focus to the page; `isDisabled` is for what cannot be pressed at all, such as a submit button before the page is alive or the arrow of the last week, which hands the focus to the other arrow first.
- Fonts: `next/font/local` with the variable woff2 files of `@fontsource-variable/inter` and `@fontsource-variable/noto-sans-arabic`; `--font-sans` is chosen per `:lang()`.
- Practice brand: as built, presets and custom scales alike through `brandStyle` on a practice page, because the root layout does not know the practice; `data-brand` stays for pages that do. A custom scale is rendered as a nonce'd `<style>:root{--brand-50:…}</style>` by `brandStyle(scale)`, which accepts exactly 11 values matching `^#[0-9a-f]{6}$` and otherwise falls back to the Teal preset. A unit test feeds it `#000;}</style><script>`.

## 10. Motion

- `lib/motion/gsap.ts` (`"use client"`) registers `useGSAP` once, and `ScrollTrigger`, `Flip` or `CustomEase` only when a feature needs them. The first users are P03 and P06 (section reveals, free-time chips) and RT01 (a new booking entering the list with Flip).
- `lib/motion/inline-x.ts`: `inlineX(distance)` returns `-distance` when the document direction is `rtl`.
- `lib/motion/use-motion.ts` wraps `gsap.matchMedia()` with `(prefers-reduced-motion: no-preference)`; under reduced motion the end state applies at once, or an opacity fade no longer than the `fast` duration.
- Durations and eases come from the motion tokens: CSS variables for transitions, a TypeScript object for GSAP whose eases `CustomEase` builds from the token control points.
- GSAP is imported only by client components that animate, never by server components or the shared layout. Only `transform` and `opacity` are animated. Server-rendered content above the fold is never hidden until hydration.

## 11. Error boundaries and UI states

- `[locale]/error.tsx`: localized error state with a Retry button (`reset()`) and the request id in small print for 5xx. `[locale]/not-found.tsx` and `global-error.tsx` complete the set.
- A server-component `ApiError` with status 404 becomes `notFound()`.
- `<QueryState>` renders loading (`Skeleton`), empty (`Empty` with the next action), error (`ErrorState` with retry) and success.
- Mutation errors become toasts unless `meta.handlesError`; forms show field errors. The full error flow is in [05](05-errors-i18n-tokens.md).

## 12. Forms

react-hook-form 7.91 with `zodResolver` and the generated schema from `@medibooker/api-client/zod`, laid out with shadcn's `FieldGroup` and `Field`. `applyFieldErrors` maps server field errors onto the fields (`data-invalid` on the field, `aria-invalid` on the control); when there are none, the form shows an `Alert`. Forms use POST, and their fields stay read-only and their button disabled until the page is alive: before that a browser would send the form itself, password included, and React would drop what was typed. Zod's issues become the codes of the `validation` catalogue (`validationMessageOf`). Focus moves to the first invalid field, and bookings send an `Idempotency-Key` that a retry reuses. While a request runs, the submit button waits with the focus on it (§9), and the form ignores Enter: a waiting button is no submit button, and without one Enter in a single field would send the form again, with a token that works once.

## 13. Security rules

- The CSP of §4; no `dangerouslySetInnerHTML` with one exception: the JSON-LD component, which escapes `<` and carries the nonce.
- No `localStorage` or `sessionStorage` (lint, in the `react` preset), without an exception since B07: the booking page, signed in, chooses its time itself, and the choice stays in that page's memory (before, a time chosen on the public page went through signing in in `sessionStorage`). No third-party scripts, fonts, maps or analytics; external links with `rel="noopener noreferrer"`.
- Public pages set no cookies; e2e tests assert there is no `Set-Cookie` and no third-party request.

## 14. Testing

- **Vitest 5** (`vitest.config.ts`): `@vitejs/plugin-react` 6.1.2 with the React Compiler through `@rolldown/plugin-babel` and `reactCompilerPreset()`, the same Babel compiler `next build` uses; jsdom 30; `server-only` aliased to `test/empty.ts`; `test.env: { TZ: 'Pacific/Chatham' }`.
- **`test/setup.ts`:** `faker.seed(20261101)` and `faker.setDefaultRefDate('2026-11-16T05:00:00Z')` before each test, MSW with `onUnhandledRequest: 'error'`, a `next/navigation` mock. `test/render.tsx` exports `renderWithProviders(ui, { locale, timeZone })` with `createTestQueryClient()`.
- **Playwright 1.64.1** (`playwright.config.ts`):
  - projects `ar-rtl` (`locale: 'ar-SA'`, `timezoneId: 'Asia/Riyadh'`) and `en-ltr` (`'en-GB'`, `'Europe/Berlin'`) at 1440 and 390 px; from P03 also `webkit-ar-rtl` at 390 px for the public page;
  - `forbidOnly: !!process.env.CI`, `retries: process.env.CI ? 1 : 0`, `failOnFlakyTests: !!process.env.CI`, `updateSnapshots: process.env.CI ? 'none' : 'missing'`, reporters `html` and `junit`;
  - axe runs as an automatic fixture after every test and fails on serious or critical violations;
  - the web server is the standalone `server.js` (after copying `.next/static` and `public`), and from P03 the built API with the compose databases (the platform database and the two seeded practice databases);
  - every test fixes the browser clock at `2026-11-16T05:00:00Z` (Monday 08:00 in Riyadh) while the API runs with `CLOCK_FIXED_AT` set to the same instant.
- **Test data:** the seeded practices are read-only; a test that changes data provisions its own practice database through `e2e/support/fixtures.ts` ([06 §3](06-testing.md#3-determinism)).
- Visual tests are tagged `@visual` and run only on Linux; baselines come from the `visual-baselines` workflow or `pnpm --filter @medibooker/web test:e2e:update-snapshots`, which runs inside `mcr.microsoft.com/playwright:v1.64.1-noble`.

Test strategy and rules: [06](06-testing.md).
