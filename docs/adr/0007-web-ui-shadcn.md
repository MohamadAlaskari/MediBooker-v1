# 0007. Web UI components: shadcn/ui on React Aria
Status: Accepted — 2026-11-01 (decided by the client)

History: 2026-11-04 the CLI runs from an exact-pinned devDependency of `apps/web` instead of the newest release through npx (security review); the decision is unchanged.

## Context

The web app (public practice page, patient portal and practice dashboard; ADR 0003) needs a set of components that:
- is accessible and works right-to-left;
- follows the design tokens and the practice themes (ADR 0002).

The client asked for shadcn/ui. shadcn/ui is not a runtime dependency: its CLI (4.23.0 at the time of this decision) copies the component source into the repository, styled with Tailwind CSS v4 and CSS variables.

Two recent additions matter for us:
- **RTL support (since January 2026).** With `rtl: true` in `components.json`, the CLI converts physical classes to logical ones (`ml-4` → `ms-4`, `left-*` → `start-*`, `text-left` → `text-start`) and flips directional icons.
- **Three primitive bases.** Base UI (the default), Radix, and React Aria Components (`--base aria`, since July 2026).

## Decision

1. **Base and RTL.** Web components come from shadcn/ui, initialised with `--base aria` and `--rtl`; React Aria Components runs underneath. We chose the React Aria base because:
   - Arabic is the default locale, and React Aria handles RTL layout, RTL keyboard navigation and Arabic formatting natively;
   - its date components support non-Gregorian calendars (for example Islamic Umm al-Qura) through `@internationalized/date`, which some target markets may need;
   - it has a strong accessibility record (non-negotiable 6);
   - the blueprint had already chosen react-aria-components, so we keep one primitive library, not two.
2. **Location and ownership.** The components live in `apps/web/src/components/ui` (shadcn's default `@/components/ui`; `components.json` in `apps/web`). A separate package is not needed while there is one web app. We own this code and edit it to match our design system instead of wrapping it. Components are added and updated only with the CLI, so that upstream fixes can be merged: `pnpm --filter @medibooker/web exec shadcn add …`, and `--dry-run` / `--diff` before every update. The CLI is an exact-pinned devDependency of `apps/web` from the catalog, so pnpm's one-day release-age gate and the lockfile apply to it as to every other package (ADR 0006).
3. **Theming.**
   - shadcn's CSS variables are mapped to our semantic tokens in one file, `apps/web/src/styles/theme.css`. The file contains no raw colour values; all values come from the generated token CSS (X05).

     | shadcn variable | Token |
     |---|---|
     | `--background` | `--color-bg-canvas` |
     | `--foreground` | `--color-text-primary` |
     | `--card` | `--color-bg-surface` |
     | `--popover` | `--color-bg-surface-raised` |
     | `--primary` | `--color-bg-brand` |
     | `--primary-foreground` | `--color-text-on-brand` |
     | `--muted` | `--color-bg-subtle` |
     | `--muted-foreground` | `--color-text-secondary` |
     | `--destructive` | `--color-bg-danger` |
     | `--border`, `--input` | `--color-border-default` |
     | `--ring` | `--color-border-focus` |
     | `--radius` | `--radius-md` |

   - Dark mode stays on `[data-theme='dark']`, as the token pipeline defines it. Tailwind's `dark` variant is redefined to that attribute.
   - Practice themes change only `--brand-*` (ADR 0002), so every component follows the practice colour automatically. Status colours stay fixed.
4. **Design system over defaults.** Sizes, radii, typography and states follow the Figma components, not shadcn's defaults:
   - interactive targets are at least 44 × 44 px on touch screens;
   - the focus ring uses `border/focus`;
   - text uses the Arabic and English type scales;
   - Inter and Noto Sans Arabic are self-hosted.
5. **Usage rules:**
   - Forms use `FieldGroup` / `Field` with react-hook-form, Zod and the problem+json field errors (`data-invalid` on the field, `aria-invalid` on the control).
   - Items always sit inside their group.
   - Every Dialog, Sheet and Drawer has a title.
   - Use `Badge`, `Alert`, `Empty`, `Skeleton` and `Spinner` instead of custom markup.
   - Toasts use sonner.
   - Icons come from lucide-react, placed with `data-icon="inline-start|inline-end"`.
   - `className` is for layout only.
   - Only logical direction classes: the ESLint guardrail `no-physical-direction-classes` stays on.
   - Every string goes through i18n.
6. **Mobile is out of scope.** shadcn/ui is web-only. The patient app keeps its own React Native components, built from the same tokens (CLAUDE.md, "UI sharing").

## Consequences

**Positive:**
- accessible, production-ready components quickly, in code we own;
- consistent with tokens and practice themes;
- RTL and Arabic calendars built in.

**Negative:**
- Copied code has to be maintained. Upstream fixes are merged through the CLI diff, and our design-system adjustments have to be kept when upstream changes.
- The React Aria base is newer than the Radix and Base UI bases. A component or community block that exists only for Radix or Base UI is ported to React Aria; we don't add a second primitive library.

**Follow-ups:**
- X07 (web UI kit v1) initialises shadcn in `apps/web`, writes `theme.css`, and adjusts the variants to the Figma components.
- A test proves that every shadcn variable resolves to a token and that the file contains no raw values.
- A component overview page is rendered in RTL and LTR and in light and dark mode, with axe checks.

## Alternatives considered

- **Radix base:** the largest ecosystem of shadcn blocks and examples, but no built-in support for non-Gregorian calendars or locale-aware date fields comparable to React Aria.
- **Base UI base (the shadcn default):** modern and accessible, but with fewer internationalised date and number components than React Aria.
- **React Aria Components without shadcn (the blueprint's plan):** more styling work per component; the client asked for shadcn.
