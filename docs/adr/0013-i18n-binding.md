# 0013. i18n binding: next-intl

Status: Accepted — 2026-11-06 (decided by the client: decision D1, option B)

## Context

Arabic is the default language and every text is an ICU message in `@medibooker/i18n`. The catalogue stays the same whichever library renders it, so this decision only chooses the bindings on the web, in the app and in server texts. The options and their trade-offs are in [05 §2.2](../architecture/05-errors-i18n-tokens.md#22-binding-decision-d1).

## Decision

1. **next-intl on the web, use-intl in the app, `use-intl/core` for e-mail, push and SMS texts.** One engine renders every text from one catalogue, ICU natively, with typed keys through the `AppConfig` augmentation (`apps/web/src/i18n/app-config.d.ts`).
2. **The language comes from the path.** `src/i18n/request.ts` reads the `[locale]` segment through `next/root-params`, as next-intl now recommends; `setRequestLocale` and `requestLocale` are deprecated.
3. **No next-intl middleware.** `src/proxy.ts` keeps its own redirect from a path without a language, which also answers 404 for a language we lack, and its CSP nonce. Public pages stay free of cookies, because nothing sets a locale cookie. hreflang comes from `generateMetadata`.
4. **The practice's time zone is never global.** The request config stays on UTC; dates, times and numbers of a practice go through `lib/format.ts` with its zone, digits and hour cycle.
5. **Client components get only the namespaces they need,** so a page does not ship the catalogue.

## Consequences

- Mostly one maintainer behind next-intl: the catalogue and `lib/format.ts` have no dependency on it, so a change of binding touches only the components' hooks.
- `routing.ts` and `navigation.ts` of 03 §8 wait for the first client-side navigation (A05). A change of language is a full page load, because it is a new document with its own direction and nonce.
- `apps/mobile` and the API add their bindings with X08 and A02.
