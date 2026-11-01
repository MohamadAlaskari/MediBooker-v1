# 0003. Web framework: Next.js (App Router)
Status: Accepted — 2026-11-01 (decided by the client)

## Context

The web app has three parts: the public practice page (no sign-in), the patient portal and the clinic dashboard. The public page must be readable by search engines in Arabic and English, shows free times without sign-in and must render in the practice's colour theme without a flash of the default theme (ADR 0002). Portal and dashboard are signed-in applications with live updates. React and TypeScript were already confirmed; the open choice was a Vite single-page app or Next.js.

## Decision

1. `apps/web` uses **Next.js with the App Router** and TypeScript, deployed as a Node.js container (standalone output) in the market's hosting region. No features that only work on one hosting provider.
2. Route groups: `(public)` for the practice page, `(patient)` for the portal, `(practice)` for the dashboard; all under a locale segment (`/ar/...`, `/en/...`, Arabic default).
3. Public practice page: server-rendered and cached (revalidated when the practice data changes; free times refresh at least every 30–60 seconds or on the client); `generateMetadata` with `hreflang` alternates, `sitemap.ts`, `robots.ts` and `schema.org/MedicalClinic` JSON-LD. No cookies, no third-party scripts.
4. Portal and dashboard: client components with the generated API client and TanStack Query (unchanged rules in `react-web-feature`); realtime with Socket.IO in the dashboard. Pages with personal or health data are never cached by Next.js or a CDN (`dynamic`, `no-store`).
5. The practice theme (`--brand-*` CSS variables) and `<html lang dir>` are set on the server for every request.
6. Security: strict CSP with per-request nonces set in middleware; tokens stay in `HttpOnly` cookies as defined in `api-contract`; server components never pass tokens or health data to client props they do not need.

## Consequences

Positive: one framework for SEO pages and the signed-in app; server-side theme and direction avoid flicker; good i18n routing.
Negative: a Node.js server to run and monitor instead of static files; more concepts (server vs. client components, caching); the team must keep personal data out of shared caches.
Follow-ups: `devops-engineer` adds the container, health check and caching headers; `web-engineer` sets up middleware (locale, CSP nonce), the route groups and the token export for the theme; decide the i18n library binding for server components (i18next is the proposed library).

## Alternatives considered

- Vite SPA + a separately pre-rendered public page: simple hosting, but two build pipelines and no server-side theme or free times for crawlers.
- Remix / React Router framework mode: comparable, smaller ecosystem for this team.
- Astro for the public page only: excellent for content pages, but a second framework next to the React app.
