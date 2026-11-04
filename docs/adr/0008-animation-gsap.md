# 0008. Animation: GSAP on the web, Reanimated in the app
Status: Accepted — 2026-11-01 (decided by the client)

## Context

The client wants GSAP for animations. The web uses motion in four places:
- the public practice page: section reveals and the free-time chips;
- the booking flow: step transitions and the confirmation;
- the practice dashboard: a new booking arriving live, list and calendar changes;
- feedback such as toasts.

GSAP (3.15.0, with `@gsap/react` 2.1.2 at the time of this decision) has been free for commercial use since 3.13 under the GSAP Standard "no charge" licence. This includes the former Club plugins (ScrollTrigger, Flip, SplitText, CustomEase). The licence excludes tools that compete with Webflow's visual website builder; MediBooker is not such a tool. Legal confirms this during contract review.

GSAP needs the DOM, so it does not run in React Native.

## Decision

1. **Web setup.** The web app uses `gsap` and `@gsap/react`. Plugins are registered once, in the client module `apps/web/src/lib/motion/gsap.ts` (`"use client"`): `useGSAP` always, and `ScrollTrigger`, `Flip` or `CustomEase` only when a feature needs them.
2. **What uses what:**

   | Motion | Tool |
   |---|---|
   | Enter and exit of shadcn / React Aria primitives (dialog, popover, sheet, tooltip, select) | CSS transitions, as shadcn ships them, timed with the motion tokens (ADR 0007) |
   | Hover, focus and pressed states | Plain CSS |
   | Orchestrated sequences and timelines | GSAP |
   | Scroll-driven reveals | GSAP ScrollTrigger |
   | Layout changes, for example a new appointment entering the dashboard list | GSAP Flip |
   | Data-driven motion | GSAP |

3. **Rules:**
   - **React integration.** GSAP is used only through `useGSAP()` with a `scope` ref. Callbacks created later (event handlers) are wrapped in `contextSafe`. Nothing calls gsap or ScrollTrigger during server rendering, and Server Components never import gsap.
   - **Reduced motion.** Every animation is created inside `gsap.matchMedia()` under `(prefers-reduced-motion: no-preference)`. With reduced motion, the end state is applied at once, or with an opacity fade no longer than the `fast` duration.
   - **WCAG.** No motion plays automatically for longer than 5 seconds (2.2.2), and nothing flashes (2.3.1).
   - **RTL.** Horizontal motion goes through the helper `inlineX(distance)` from `apps/web/src/lib/motion`, which flips the sign when the document direction is `rtl`. Animation code contains no physical left/right values.
   - **Content first.** Server-rendered content is complete and visible without JavaScript. Entrance animations apply only below the fold (ScrollTrigger) or to client-side state changes. They never hide above-the-fold content until hydration, which keeps the public page working for search engines and without JavaScript (ADR 0003).
   - **Performance.** Animate only `transform` and `opacity`. Animations are reverted on unmount (`useGSAP` does this). ScrollTrigger refreshes after the fonts have loaded. GSAP is imported only by the client components that animate, never by the shared layout.
   - **CSP.** GSAP writes styles through the CSSOM (`element.style`), which the nonce-based CSP of ADR 0003 allows. No inline `<style>` element is injected.
4. **Motion tokens.** Durations (`motion/duration/instant`, `fast`, `base`, `slow`) and easings (`motion/ease/standard`, `enter`, `exit`, stored as cubic-bezier control points) join the design tokens: a Motion collection in Figma, then the X05 pipeline. The pipeline exports them in three forms:
   - CSS variables, for CSS transitions;
   - a TypeScript object for GSAP, where `CustomEase` builds the eases from the same control points;
   - the React Native theme.
5. **Mobile.** The patient app uses `react-native-reanimated`, in the version pinned by the Expo SDK. It uses the same motion tokens and the same reduced-motion rule (`useReducedMotion`). Direction comes from `I18nManager.isRTL`.

## Consequences

**Positive:**
- one capable engine for complex web motion;
- the same timing on web and mobile through shared tokens;
- accessible by default.

**Negative:**
- Pages that animate load several tens of kilobytes (gzip) more JavaScript for the GSAP core and plugins. GSAP is therefore loaded only where it is used.
- The team has to know two animation stacks: GSAP on the web, Reanimated on mobile.
- The licence terms have to be checked again if GSAP changes its licence.

**Follow-ups:**
- X05 adds the motion tokens; the ui-designer adds the Motion collection in Figma.
- X06 adds the GSAP setup, `inlineX` and the reduced-motion wrapper, with tests.
- X07 documents the motion patterns in the UI kit.
- P03 and P06 (public page and free times) and RT01 (realtime dashboard) are the first GSAP users.

## Alternatives considered

- **Motion (formerly Framer Motion):** React-first and smaller for simple cases; the client chose GSAP.
- **CSS only:** enough for micro-interactions, which keep using it, but weak for sequenced, scroll-driven and layout animations.
