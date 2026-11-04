---
name: design-system
description: The MediBooker v2 design system — Figma file structure, design tokens (colour Light/Dark, practice brand themes, typography English/Arabic, spacing, radius, border width, elevation) with their Figma variable names and CSS / React Native mappings, responsive breakpoints (phone, tablet, desktop), RTL rules and the Direction variant property, the component inventory with variants and properties, icons, appointment-status colours, UX writing for Arabic and English, accessibility rules, and the token export pipeline. Use when designing in Figma, implementing UI in the React web app or the React Native app, reviewing UI, or adding or changing tokens or components.
---

# MediBooker design system

Figma: https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker (fileKey `8Ww6QyOO2Ni9kSfN6E5hNK`)

Figma variables and styles are the single source of truth. They are exported to `packages/design-tokens` and consumed as CSS variables on the web and as a typed theme in React Native. Never hard-code a colour, spacing, radius or font size in app code. If a value is missing, the `ui-designer` adds a token in Figma first, then it is exported.

- **Languages:** Arabic (default, right-to-left) and English; more later. Every screen exists in Arabic RTL first, then English LTR.
- **Brand status:** working brand "MediBooker" (teal; Inter + Noto Sans Arabic). Every practice can choose a colour theme (presets or a checked custom colour, see "Practice themes"); the MediBooker logo always stays teal. With a client corporate design only the primitive values change; semantic tokens and components stay.

## Figma file structure

| Page | Content |
|---|---|
| Cover | Title, version, status |
| Foundations | Colour primitives, semantic colours (Light / Dark), typography (English and Arabic specimens), spacing, radius, elevation |
| Icons | `Icon/<lucide-name>` components (58), 24×24, 2 px stroke; Logo (Type = Mark, Full) |
| Buttons | Button, Icon Button |
| Form Controls | Text Field, Text Area, Checkbox, Radio, Switch, Theme Swatch |
| Badges & Avatars | Badge, Avatar, Doctor Option, Practice Mark, Team Card |
| Booking | Time Slot, Calendar Day, Service Card, Step, Appointment Card, Calendar Event |
| Navigation | System/Status Bar, System/Home Indicator, System/Push Notification, System/SMS Bubble, Top App Bar, Tab Bar Item, Tab Bar, Segment, Segmented Control, Tab, Sidebar Item, Sidebar, Portal Header |
| Feedback | Alert, Toast, Dialog, Empty State |
| Data Display | List Item, Stat Card, Appointment Row |
| Records & Family | Note Card, Attachment Tile, Upload Dropzone, Person Card, Timeline Item, Patient Row |
| Patient App (Mobile) | 33 screens (390×844), see "Screens" below |
| Clinic Dashboard (Web) | 21 screens W1–W21 (1440×1024) + theme example, see "Screens" below |
| Patient Portal (Web) | 12 screens PW1–PW12 (1440×1024) + public practice page PW13 (desktop) / PW14 (mobile web) in a band below + theme examples |
| Email Templates | 10 e-mails E01–E10 (600 px), see "E-mail templates" below |
| Tablet Layouts | T1–T8: app and portal portrait 834×1194, dashboard landscape 1194×834 |

Every component page has a header, the component sets and an examples frame with light, dark and Arabic RTL rows.

## Screens

Every screens page (app, dashboard, portal, e-mails) has four rows: **Arabic RTL · Light** (top), **Arabic RTL · Dark**, **English LTR · Light**, **English LTR · Dark**. Frame names: `<number> <name> · EN`, `… · AR`, `… · AR · Dark`, `… · EN · Dark`. The column (x position) is the same for one screen in all four rows. The screen list with features is in `docs/product/feature-catalog.md` (section 5).

- **Patient App:** 01 Sign in · 02 Home · 03–06 Book (service, date & time, review, booked) · 07/07b/08 My appointments (list, empty, cancel dialog) · 09–11 Sign up · 12 Verify email · 13 Forgot password · 14 Book – who is it for? · 15 Review – time taken · 16 Appointment details · 17 Reschedule · 18 Past appointments · 19 Health record · 20 Visit details · 21 Document viewer · 22 Profile · 23 Personal details · 24 Family members · 25 Add family member · 26 Privacy & data · 27 Language · 28 Allow notifications · 29 Notification settings · 30 Push – lock screen (iOS) · 31 Push – notification shade (Android) · 32 SMS – Messages.
- **Clinic Dashboard:** W1 Today · W2 Calendar · W3 Sign in · W4 Two-factor · W5 Appointments · W6 Appointment details (drawer) · W7 Book for patient (modal) · W8 Patients · W9–W11 Patient record (Overview, Notes, Files) · W12 Services · W13 Edit service (modal) · W14 Working hours · W15 Team · W16 Invite staff (modal) · W17 Settings · W18 Audit log · W19 Settings – Appearance · W20 Settings – Practice page · W21 Settings – Notifications. W17, W19, W20 and W21 share the tab row General · Practice page · Appearance · Notifications.
- **Patient Portal:** PW1 Sign in · PW2 Home · PW3–PW6 Book (person & service, date & time, review, booked) · PW7 My appointments · PW8 Appointment details · PW9 Cancel (modal) · PW10 Health record · PW11 Family · PW12 Settings – Notifications. Layout: Portal Header (72) + centred 1120 px container; side columns 320–420 px.
- **Public practice page (no sign-in):** PW13 desktop (1440, height hugs content) and PW14 mobile web (390). They sit in a band below the portal rows because they are taller than 1024 px: columns AR, AR dark, EN, EN dark, mobile next to desktop. Sections: public header (Practice Mark + name, section links, language switch, Sign in, Book appointment), hero on `bg/brand-subtle` with open-now Badge, facts and opening hours card, **free times** (service select, Doctor Options, week strip of Calendar Days with weekday labels, Time Slots for morning and afternoon — public, no sign-in), services (Service Card with the `Indicator` layer hidden — a card scrolls to the free times, it is not a selection), team (Team Card), find us and contact (List Item), footer with legal links and "Online booking with" + Logo.
- **Tablet Layouts:** T1–T3 app (two panes, tab bar stays), T4–T6 dashboard (sidebar + list/detail panel instead of the drawer), T7–T8 portal (Portal Header `Size=Compact` with menu). Code breakpoints for the web: below 744 px phone layout (one column, compact header), 744–1279 px tablet (compact header, two columns), from 1280 px desktop (full header, 1120 container). React Native: two-pane layouts from 600 dp width.
- **Theme examples:** extra frames named `… · Theme <Preset>` (W19 · Theme Ocean, PW13 · EN · Theme Violet, PW14 · AR · Dark · Theme Ocean) show a practice theme; they are not part of the four rows.
- The signed-in user in the sidebar matches the role the screen needs: reception (Nour Khalil) for booking screens, doctor (Dr. Lina Mansour) for clinical screens (W6, W9–W11), admin (Rania Saad) for W12–W18.
- Mock clinic calendar: week starts on Sunday, weekend Friday and Saturday, 19 Nov 2026 closed (team training). Use the same in every calendar.

## Clickable prototype

- Every screens page is a prototype. Flow starting points per page and row: `App · العربية (فاتح)`, `App · English (light)`, `… (داكن)`, `… (dark)`, `Push · …`, `SMS · …`, `Dashboard · …`, `Portal · …`, `Practice page · …`, `Practice page (mobile) · …`, `Tablet app · …`, `Tablet dashboard · …`, `Tablet portal · …`.
- Section links on the long public page use the Scroll-to action (Scroll animate 0.4 s) to the section frame; "Book appointment" and service cards scroll to "Free times", a free time opens PW1 Sign in.
- Interactions are set directly on component instances, also nested ones (tab bar items, sidebar items, header tabs, dialog actions, the Top App Bar `Back`). Back buttons and modal close buttons use the BACK action.
- Transitions: forward on mobile = Push from the reading direction (Left in English, Right in Arabic), 0.3 s ease-out; tabs, web pages and modals = Dissolve 0.2 s; dashboard drawer = Move in from the end edge.
- Language switches (27 Language "Apply", web language buttons) navigate to the same screen in the other language row; dark rows link to dark rows.
- Push previews (30, 31) open the matching app screen. Push permission (28) comes after the first booking (06 → 28 → 02).
- Prototypes work per page: links between app, portal and e-mails are documented, not wired.

## E-mail templates

- 600 px content on a canvas background; header with clinic logo and name; body with title (H2), text (Body/Default), optional details box (`bg/subtle`, label + value rows), optional Alert, one primary button (Danger only for security actions), optional link and small print; footer (`bg/subtle`) with address, reason for the e-mail, settings and privacy links, "Sent with MediBooker".
- Subject and preview text sit above each e-mail in Figma ("Subject: …" / "الموضوع: …").
- Code: table-based HTML (React Email or MJML), `dir="rtl"` and `lang="ar"` for Arabic, bulletproof buttons, plain-text part, font stack "Noto Sans Arabic", Tahoma, Arial / Inter, Arial; light colours as the default, dark rows show the client dark-mode check. Content rules: `docs/product/notifications.md`.

## Tokens

### Collections

| Collection | Modes | Content |
|---|---|---|
| `Primitives` | Value | Raw palette, hidden from pickers; never used directly |
| `Brand` | Teal (default), Ocean, Indigo, Violet, Graphite | `brand/50 … brand/950`, aliases to the preset's primitive scale; hidden from pickers; WEB code syntax `var(--brand-600)` |
| `Color` | Light, Dark | Semantic colours: brand tokens alias `brand/*`, all others alias primitives |
| `Typography` | English, Arabic | `font/family/sans`, `font/style/*`, `font/line-height/*` — bound to every text style |
| `Dimension` | Value | `spacing/*`, `radius/*`, `border-width/*` |

Naming: Figma `color/bg/canvas` → CSS `--color-bg-canvas` → React Native `theme.color.bg.canvas`. The WEB code syntax of every variable is `var(--…)`, so Dev Mode shows the CSS variable. A frame shows Arabic typography by setting its `Typography` mode to Arabic, dark mode by setting its `Color` mode to Dark, and a practice theme by setting its `Brand` mode.

### Primitive palette

`teal` (default brand) 50–950, theme scales `ocean`, `indigo`, `violet`, `graphite` 50–950, `gray` 0 (white) and 50–950, `red`, `amber`, `green`, `blue` 50–950, plus `alpha/scrim`. Anchors: `teal/600` #0B7A6E (primary), `gray/900` #171C22 (text), `gray/50` #F7F8FA (canvas), `gray/500` #657080. Step 600 of every theme scale: ocean #0A6699, indigo #4049C2, violet #6E3DB8, graphite #4F5C70.

### Semantic colours (Light → Dark)

| Token | Light | Dark | Use |
|---|---|---|---|
| `color/bg/canvas` | gray/50 | gray/950 | App background |
| `color/bg/surface` | gray/0 | gray/900 | Cards, sheets, inputs |
| `color/bg/surface-raised` | gray/0 | gray/800 | Menus, dialogs, popovers |
| `color/bg/subtle` | gray/100 | gray/800 | Hover rows, secondary areas |
| `color/bg/muted` | gray/200 | gray/700 | Tracks, skeletons |
| `color/bg/brand` | brand/600 | brand/400 | Primary buttons, selected items |
| `color/bg/brand-hover` / `-pressed` | brand/700 / brand/800 | brand/300 / brand/200 | Interaction states |
| `color/bg/brand-subtle` / `-muted` | brand/50 / brand/100 | brand/950 / brand/900 | Selected cards, chips, avatars |
| `color/bg/danger` / `-hover` / `-subtle` | red/600 / red/700 / red/50 | red/400 / red/300 / red/950 | Destructive, errors |
| `color/bg/success`, `-subtle` | green/600, green/50 | green/400, green/950 | |
| `color/bg/warning`, `-subtle` | amber/500, amber/50 | amber/400, amber/950 | |
| `color/bg/info`, `-subtle` | blue/600, blue/50 | blue/400, blue/950 | |
| `color/bg/disabled` | gray/100 | gray/800 | Disabled controls |
| `color/bg/inverse` | gray/900 | gray/50 | Toasts, tooltips |
| `color/bg/overlay` | alpha/scrim | alpha/scrim | Modal backdrop |
| `color/text/primary` / `secondary` / `tertiary` / `disabled` | gray/900 / 600 / 500 / 400 | gray/50 / 300 / 400 / 600 | Text hierarchy |
| `color/text/brand` | brand/700 | brand/300 | Links, brand text |
| `color/text/on-brand`, `on-danger` | gray/0 | gray/950 | Text on filled brand/danger |
| `color/text/danger`, `success`, `warning`, `info` | red/700, green/700, amber/700, blue/700 | red/300, green/300, amber/300, blue/300 | Status text on subtle backgrounds |
| `color/text/inverse` | gray/50 | gray/900 | Text on `bg/inverse` |
| `color/border/default` / `subtle` | gray/200 / gray/100 | gray/700 / gray/800 | Decorative borders |
| `color/border/strong` | gray/500 | gray/400 | Inputs, checkboxes (≥ 3:1) |
| `color/border/brand`, `danger`, `focus` | brand/600, red/600, brand/600 | brand/400, red/400, brand/400 | Selected, error, focus ring |
| `color/icon/primary`, `secondary` | gray/700, gray/500 | gray/200, gray/400 | Icons |
| `color/icon/brand`, `on-brand`, `on-danger` | brand/600, gray/0, gray/0 | brand/400, gray/950, gray/950 | |
| `color/icon/danger`, `success`, `warning`, `info` | red/600, green/600, amber/600, blue/600 | red/400, green/400, amber/400, blue/400 | |
| `color/icon/disabled`, `inverse` | gray/400, gray/50 | gray/600, gray/900 | |

All text/background pairs meet WCAG 2.2 AA (4.5:1) in both modes; borders and icons meet 3:1 against every surface (140 pairs verified). Re-run the check whenever a primitive changes. Disabled states are exempt and use `text/disabled`.

### Practice themes (ADR 0002, BR-23)

- Only the nine brand tokens above follow the theme. Neutrals and status colours (danger, warning, success, info) never change, so red, amber and green keep their meaning.
- Presets = modes of the `Brand` collection. Measured contrast (light: button text on brand/600, links brand/700 on canvas, focus brand/600 on canvas; dark: button text gray/950 on brand/400, links brand/300 on surface):

| Preset | Button light | Link light | Focus light | Button dark | Link dark | Focus dark |
|---|---|---|---|---|---|---|
| Teal (default) | 5.22 | 6.72 | 4.91 | 7.59 | 9.49 | 7.59 |
| Ocean | 6.23 | 7.76 | 5.86 | 6.42 | 8.28 | 6.42 |
| Indigo | 7.12 | 8.75 | 6.70 | 5.38 | 7.33 | 5.38 |
| Violet | 6.95 | 8.50 | 6.54 | 5.62 | 7.54 | 5.62 |
| Graphite | 6.78 | 8.44 | 6.38 | 6.08 | 8.16 | 6.08 |

- Custom colour: code generates the 11 steps with the same lightness targets (OKLCH) and runs the same pairs; if one fails, it changes lightness until it passes and reports `adjusted`. Never let a custom value bypass this check.
- Graphite is close to the neutral greys: selection must never rely on the tint alone (selected cards also get the 2 px `border/brand`).
- Pinned to Teal (explicit `Brand` mode on the component): the MediBooker `Logo` and `System/Push Notification`. Practice-owned elements (Practice Mark, buttons, links, selections) follow the theme.
- Figma: preview a theme by setting the `Brand` mode on a frame or instance; Theme Swatch instances carry their preset as an explicit mode.
- Code: web sets `--brand-50 … --brand-950` on `:root` (server-rendered, no flash); React Native gets the scale in the theme provider; e-mails get the values as inline styles. Unit tests check the contrast pairs for every preset and for sample custom colours.

### Dimensions

`spacing/0` 0 · `spacing/1` 4 · `/2` 8 · `/3` 12 · `/4` 16 · `/5` 20 · `/6` 24 · `/8` 32 · `/10` 40 · `/12` 48 · `/16` 64. `radius/none` 0 · `sm` 6 · `md` 10 · `lg` 16 · `xl` 24 · `full` 9999. `border-width/default` 1 · `strong` 2. In code use logical properties (start/end) so spacing mirrors in RTL.

### Typography

Eleven text styles. Each binds font family, weight and line height to the `Typography` collection, so the same style renders Inter (English) or Noto Sans Arabic (Arabic). Letter spacing is 0 everywhere (Arabic must not be tracked).

| Style | Size | Line height en / ar | Weight | Use |
|---|---|---|---|---|
| `Display` | 32 | 40 / 48 | Bold | Success screens |
| `Heading/H1` | 28 | 36 / 44 | Bold | Page titles |
| `Heading/H2` | 22 | 28 / 36 | Semi Bold | Section titles |
| `Heading/H3` | 18 | 24 / 30 | Semi Bold | Card titles |
| `Body/Large` | 18 | 28 / 32 | Regular | Emphasized body (mobile) |
| `Body/Default` | 16 | 24 / 28 | Regular | Default body text |
| `Body/Small` | 14 | 20 / 24 | Regular | Secondary text, tables |
| `Label/Large` | 16 | 24 / 28 | Semi Bold | Large buttons, tabs |
| `Label/Default` | 14 | 20 / 24 | Semi Bold | Buttons, form labels |
| `Label/Small` | 12 | 16 / 20 | Medium | Badges, emphasized captions |
| `Caption` | 12 | 16 / 20 | Regular | Meta information |

Code: font stack `"Noto Sans Arabic", "Inter", sans-serif` for `ar` (Latin snippets fall back to Inter) and `"Inter", sans-serif` for `en`; self-host the fonts. Mobile body text never below 16. Times use tabular figures.

### Elevation (effect styles)

`Elevation/1` (cards), `Elevation/2` (menus), `Elevation/3` (dialogs, toasts), `Focus ring` (2 px `border/focus` with a 2 px gap). Clip content must be on for the focus ring spread to render in Figma. In code: `outline: 2px solid var(--color-border-focus); outline-offset: 2px`.

### Motion (ADR 0008)

To be added in Figma as a `Motion` collection, then exported like all tokens: `motion/duration/instant` 0 · `fast` 120 · `base` 200 · `slow` 320 (ms) and `motion/ease/standard` (0.2, 0, 0, 1) · `enter` (0.05, 0.7, 0.1, 1) · `exit` (0.3, 0, 1, 1) as cubic-bezier control points. These starting values are confirmed by the ui-designer in X05. Code uses them as CSS variables (transitions), a TypeScript object for GSAP (`CustomEase`) and Reanimated (`Easing.bezier`). Reduced motion: end state at once, or an opacity fade of at most `fast`.

### Web components (ADR 0007)

The web components are shadcn/ui on React Aria, restyled to the Figma components. shadcn's CSS variables are mapped to the semantic tokens in `apps/web/src/styles/theme.css` (`--primary` → `--color-bg-brand`, `--ring` → `--color-border-focus`, `--radius` → `--radius-md`, and so on); dark mode uses `[data-theme='dark']`; practice themes change only `--brand-*`. Component sizes follow the Figma variants, not shadcn's defaults.

## RTL (Arabic) rules

- Figma has no native RTL auto layout. Direction-dependent components therefore have a variant property **`Direction = LTR | RTL`**: child order reversed, start alignment on the right, text right-aligned, start-edge accents and borders moved, directional icons swapped.
- Components with `Direction`: Button, Text Field, Text Area, Checkbox, Radio, Switch, Badge, Time Slot, Service Card, Step, Appointment Card, Calendar Event, Top App Bar, Tab Bar, Segmented Control, Tab, Sidebar Item, Sidebar, Portal Header, System/Push Notification, System/SMS Bubble, Alert, Toast, Dialog, List Item, Stat Card, Appointment Row, Note Card, Attachment Tile, Person Card, Timeline Item, Patient Row. Symmetric components have none: Icon Button, Avatar, Calendar Day, Tab Bar Item, Segment, Empty State, Upload Dropzone, Logo, System bars, Doctor Option, Practice Mark, Team Card, Theme Swatch (centred content).
- An Arabic screen = Typography mode Arabic + `Direction=RTL` on every instance + mirrored screen layout. Switch Direction first, then set texts: overrides of nested exposed instances do not survive a variant switch.
- Directional icons flip: chevron-left ↔ chevron-right, arrow-left ↔ arrow-right ("Continue" points left in Arabic; "back" points right). Never mirror clocks, check marks, media controls or the logo.
- Week strips and time grids run right-to-left; the week start and weekend days come from the clinic settings.
- Latin snippets (e-mail, phone, IDs) stay left-to-right inside Arabic text (`<bdi>` in code). Digits: Western (0–9) by default; Arabic-Indic digits are a clinic setting (`numberingSystem`).

### Bidirectional text (checked in Figma, same rules in code)

The paragraph direction comes from the first strong character. In code the container has `dir="rtl"`; in Figma we simulate it with invisible marks.

| Case | Rule | Code | Figma |
|---|---|---|---|
| Arabic string with a Latin token (PDF, JPG, CSV, file name) | Never start with the Latin token — put it last: `240 كيلوبايت · PDF`, `سارة أحمد · Blood-test-results.pdf` | Translator orders the ICU message this way | Same text |
| Phone number inside Arabic text | Keep `012 345 6789` in its LTR group order | `<bdi dir="ltr">` or U+2066 … U+2069 | Prefix U+200E (LRM) |
| Number-only strings in Arabic UI (time ranges `08:00 – 12:00`) | Start time on the right | Inherits `dir="rtl"` | Prefix U+200F (RLM) |
| Security code (OTP) boxes | Always LTR, also in Arabic | `dir="ltr"` on the group | Row named `Code (LTR)` is not mirrored |
| "from → to" | Arrow points left in Arabic: `12 ساعة ← 24 ساعة` | In the translation | Same text |
| Language names | Never translated (English, العربية); the language switch shows the *other* language | – | Language switch label = `English` on Arabic screens |
| Phone number, e-mail, IDs alone in a cell or field | Rendered LTR, aligned to the start (right) | `<bdi>` / `dir="ltr"` on the input | No mark needed |

### Arabic wording for roles and people

- Column headers and field labels use the definite article: `الطبيب`, `المريض`, `الخدمة`.
- Role labels are generic (`الطبيب`, `الاستقبال`, `المدير`); next to a known person use the gendered form (`الطبيبة` under Dr. Lina Mansour, `المديرة` under Rania Saad, `وليّة الأمر` for Sara Ahmed).
- Avatars show one Arabic initial (`س` for سارة أحمد).

## Icons

Lucide icons (ISC licence), 24×24, 2 px stroke, round caps. Figma components `Icon/<lucide-name>`, coloured with `color/icon/*`; in code `lucide-react` / `lucide-react-native` with the same names. Icons inside components are instance-swap properties. Icon-only buttons always need an accessible label.

## Components

Variant properties use `Property=Value`; code props use the same names in camelCase. Hover, pressed and focus are runtime states in code.

| Component | Variant properties | Other properties |
|---|---|---|
| Logo | Type = Mark, Full | – |
| Button | Variant = Primary, Secondary, Ghost, Danger · Size = Large (48), Medium (40) · State = Default, Hover, Disabled · Direction | Label, Leading icon (bool + swap), Trailing icon (bool + swap), Loading |
| Icon Button | Variant = Primary, Secondary, Ghost · Size = Large, Medium, Small | Icon (swap) |
| Text Field | State = Default, Filled, Focused, Error, Disabled · Direction | Label, Value, Helper text, Show helper, Show label, Leading/Trailing icon (bool + swap) |
| Text Area | State = Default, Filled, Focused, Error, Disabled · Direction | Label, Value, Helper text, Counter, Show helper, Show label |
| Checkbox | Checked = False, True, Indeterminate · State = Default, Disabled · Direction | Label (wraps; width 320 or Fill) |
| Radio | Selected = False, True · State = Default, Disabled · Direction | Label (wraps; width 320 or Fill) |
| Switch | On = False, True · State = Default, Disabled · Direction | – |
| Badge | Tone = Neutral, Brand, Success, Warning, Danger, Info · Direction | Label, Dot |
| Avatar | Size = Small (32), Medium (40), Large (56) | Initials |
| Time Slot | State = Available, Selected, Unavailable · Direction | Time |
| Calendar Day | State = Default, Today, Selected, Disabled | Day, Has slots |
| Service Card | State = Default, Selected · Direction | Title, Meta, Icon |
| Step | State = Upcoming, Current, Complete · Direction | Number, Label |
| Appointment Card | Status = Booked, Cancelled · Direction | Service, Date & time, Doctor, Day, Month, Show actions, Patient, Show patient (family bookings) |
| Calendar Event | State = Booked, Checked in, Available, Blocked · Direction | Title, Meta |
| Top App Bar | Type = Default, Large · Direction | Title, Show back, Show action |
| Tab Bar / Tab Bar Item | Direction / Active = True, False | Label, Icon |
| Segmented Control / Segment | Direction / Selected = True, False | Label |
| Sidebar / Sidebar Item | Direction / State = Default, Active · Direction | Label, Icon |
| Alert | Tone = Info, Success, Warning, Danger · Direction | Title, Description, Show description |
| Toast | Tone = Info, Success, Danger · Direction | Message, Action label, Show action |
| Dialog | Direction | Title, Body, Show icon |
| Empty State | – | Title, Text, Show button, Icon |
| List Item | Leading = Icon, Avatar, None · Trailing = Chevron, Switch, None · Direction | Title, Subtitle, Show subtitle, Icon |
| Stat Card | Direction | Label, Value, Hint, Icon |
| Appointment Row | Type = Header, Row · Direction | Time, Patient, Patient meta, Service, Doctor (+ exposed Status badge, Check-in button, Avatar) |
| Tab | State = Default, Selected · Direction | Label, Count, Show count |
| Note Card | Visibility = Internal, Shared · Direction | Initials, Author, Meta, Body, Edited, Show edited |
| Attachment Tile | Type = Image, Document · State = Default, Uploading · Direction | File name, Meta, Progress |
| Upload Dropzone | State = Default, Dragging | Title, Hint |
| Person Card | State = Default, Selected, Link · Direction | Initials, Name, Relation |
| Timeline Item | Direction | Month, Day, Title, Meta, Notes, Files |
| Patient Row | Type = Header, Row · Direction | Initials, Patient, Patient meta, Phone, Insurance, Family, Last visit, Next appointment |
| Portal Header | Size = Desktop, Compact · Direction | User name (+ exposed nav tabs `Nav Home`, `Nav Appointments`, `Nav Book`, `Nav Record`, `Nav Family`, `Language switch`, `Avatar`; Compact = tablet with menu button) |
| System/Push Notification | Platform = iOS, Android · Direction | App, Title, Body, Time (OS mock for push previews; texts follow BR-13/BR-20; pinned to Teal) |
| System/SMS Bubble | Direction | Text (OS messages-app mock for SMS previews; texts follow BR-21) |
| Doctor Option | State = Default, Selected | Name, Meta, Show meta, Show placeholder, Placeholder icon (round photo = image fill on the layer `Photo`, only with consent; "Any doctor" uses the placeholder) |
| Practice Mark | Size = Medium (40), Large (64) | Initials (logo fallback on `bg/brand`) |
| Team Card | – | Name, Role, Languages, Show placeholder, Placeholder icon (photo on the layer `Photo`) |
| Theme Swatch | Type = Preset, Custom · State = Default, Selected | Name, Caption, Show caption (preset = explicit `Brand` mode on the instance) |

Button has 48 variants (24 × Direction); the Direction axis is a mirror, not a design dimension.

Records & Family components map to the domain (`medibooker-domain`): Note Card = `ClinicalNote` (append-only; "Edited …" shows the latest version), Attachment Tile = `Attachment` (Uploading = before the scan finished), Person Card = a `Patient` profile in a family (Selected = booking target, Link = opens the profile), Timeline Item = one past visit in the record, Patient Row = staff patient list.

### Appointment status → Badge

| Status | Tone | English | Arabic |
|---|---|---|---|
| `BOOKED` | Brand | Booked | محجوز |
| `CHECKED_IN` | Info | Checked in | تم الحضور |
| `COMPLETED` | Success | Completed | مكتمل |
| `NO_SHOW` | Warning | No-show | لم يحضر |
| `CANCELLED` | Danger | Cancelled | ملغى |
| Slot `BLOCKED` | Neutral | Blocked | غير متاح |

## UX writing

- **Arabic:** Modern Standard Arabic, short and polite; address the patient directly; avoid colloquial forms and medical jargon. Gendered forms per patient where known, otherwise neutral phrasing.
- **English:** plain, sentence case, active verbs on buttons ("Book appointment", "Cancel appointment", "Continue"). Never "OK" or "Submit".
- Errors say what happened and what to do: "This time was just booked by someone else. Please choose another time." / "تم حجز هذا الموعد للتو. يرجى اختيار وقت آخر."
- Dates and times through `Intl` for the locale and clinic time zone ("Wed, 4 Nov 2026 · 09:30" / "الأربعاء، 4 نوفمبر 2026 · 09:30"). Check that weekday and date match in mock data.
- Sample data is always synthetic ("Sara Ahmed" / "سارة أحمد"). Never real patient data.

## Accessibility

- Contrast only from the semantic pairs above.
- Touch targets ≥ 44×44 pt on mobile (Large buttons are 48); on the web at least 24×24 with spacing.
- Visible focus on every interactive element.
- Never colour alone: statuses have text, selected slots have a check icon.
- Layouts reflow at 200 % text and with longer Arabic or English strings; no fixed heights on text containers.
- Respect reduced motion. Screen readers in both languages (VoiceOver/TalkBack in Arabic).

## Figma build notes (for `use_figma` scripts)

- Bind every fill, stroke, padding, gap and radius to a variable. Run the audit (SOLID paints without `boundVariables.color`, outside instances) after building; it must return 0.
- Spacers: an empty auto-layout frame defaults to 100 × 100 px. Use a plain 1 px high frame with Fill width.
- Set `layoutSizingHorizontal = 'FILL'` again after changing `layoutMode` of an appended frame.
- Arabic screens are generated from the English frame: clone → Typography mode Arabic → mirror (Direction = RTL, reverse horizontal rows, flip alignment, swap directional icons, move absolute children) → translate texts and TEXT properties → restore nested instance properties. Use symmetric padding (asymmetric padding is not mirrored).
- Dark rows are clones with Color mode Dark; nothing else changes. Theme examples are clones with a `Brand` mode.
- Load fallback fonts (Noto Sans Arabic, Noto Sans, Noto Sans Symbols 1/2) before touching text.
- A card moved from a horizontal row into a vertical column keeps `layoutGrow = 1` and collapses; set `layoutSizingVertical = 'HUG'` after moving it.
- Set `flowStartingPoints` in its own call and append flows one by one; combining it with many `setReactionsAsync` calls in one script failed with "duplicate input nodeIds".
- Inline SMS texts and placeholders in Figma use the same characters as production: straight apostrophes in English SMS (GSM-7).
- Before relying on a new screen, check the mock data against the other screens (same doctor not booked twice at one time; free slots in pickers must not collide with visible appointments; a patient's phone is not the clinic's phone).

## Token export pipeline

1. The `ui-designer` changes variables in Figma.
2. A read-only `use_figma` script dumps all variables (names, types, per-mode values, alias targets) to `packages/design-tokens/tokens.json` (W3C DTCG format).
3. Style Dictionary builds `tokens.css` (Light in `:root`, Dark in `[data-theme='dark']`, typography per `:lang(ar)` / `:lang(en)`, brand presets as `[data-brand='ocean']` etc. setting `--brand-50 … --brand-950`) and `tokens.ts` (light/dark themes, typography per locale, brand presets) for React Native. A custom practice colour overrides the `--brand-*` values at runtime.
4. CI fails if the generated files are out of date.
