---
name: react-native-screen
description: Recipe and conventions for building screens and flows in the MediBooker v2 React Native patient app (apps/mobile) — navigation, theming with design tokens and dark mode, data fetching and offline behaviour, secure token storage, push notifications, calendar integration, accessibility (screen readers, large text, touch targets), platform differences, tests and release. Use for any mobile app work.
---

# React Native screen recipe

Toolchain proposal: Expo with Expo Router and EAS Build, Submit and Update. Check CLAUDE.md for the status.

Many patients are older or not used to apps. Clarity, large text and robustness on bad networks matter more than visual effects.

## Structure

```
apps/mobile/
  app/                         Expo Router
    (auth)/login.tsx, register/[step].tsx, verify-email.tsx, forgot-password.tsx
    (tabs)/index.tsx           Home: next appointment, "Book appointment"
    (tabs)/appointments/index.tsx, (tabs)/appointments/[id].tsx
    (tabs)/profile/index.tsx
    booking/service.tsx, booking/date-time.tsx, booking/review.tsx, booking/success.tsx
    _layout.tsx                providers, auth gate, theme
  src/
    components/ui/             design-system components (same names and props as in Figma)
    features/<feature>/        hooks, components, schemas
    lib/                       API client setup, auth storage, notifications, format helpers
    theme/                     generated tokens + useTheme()
    locales/ar.json, locales/en.json   (Arabic is the default; more locales later)
```

## Rules

1. **Design system.** Use `components/ui`, mirroring the Figma names and props. Style only through `useTheme()` tokens (`theme.color.bg.surface`, `theme.spacing[4]`, `theme.radius.md`, typography presets). Follow the system colour scheme (light and dark). The practice theme (brand scale from the practice configuration, ADR 0002) is applied in the theme provider; never hard-code a brand colour.
2. **Layout.** Safe-area insets on every screen; keyboard avoidance on forms. Test on a small device (375 pt wide, for example iPhone SE) and a large one, on iOS and Android. From 600 dp width (tablets) use the two-pane layouts of the Figma page "Tablet Layouts" (T1–T3); the tab bar stays.
3. **Touch and text.** Touch targets of at least 44×44 pt (use `hitSlop` for small icons). Never disable font scaling. Layouts must work at the largest accessibility text sizes: text wraps, no fixed heights.
4. **Accessibility.** Every touchable element has `accessibilityRole`, `accessibilityLabel` and state (`selected`, `disabled`, `checked`). Logical focus order. Announce async results (`AccessibilityInfo.announceForAccessibility(t('booking.success'))`). Test with VoiceOver and TalkBack in Arabic and English.
4a. **Languages and RTL.** Arabic is the default locale, English the second; locale from the user profile, falling back to the device (`expo-localization`). Direction follows the locale: `I18nManager.allowRTL(true)` and `forceRTL(isRTL)`, then reload the app (`expo-updates` `reloadAsync`) when the direction changes. Style with `start`/`end` props (`marginStart`, `paddingEnd`, `start`, `end`), never `left`/`right`. Mirror directional icons when `I18nManager.isRTL` (`transform: [{ scaleX: -1 }]`); never mirror clocks, check marks or the logo. Fonts: Noto Sans Arabic for `ar`, Inter for `en` (bundled via `expo-font`); typography presets switch with the locale. Numbers and dates via `Intl` with the practice's `numberingSystem`, `hourCycle` and time zone. Mixed Arabic/Latin text follows the bidi table in `design-system`: phone numbers, e-mails and IDs inside Arabic text are wrapped in U+2066 … U+2069 (LTR isolate); security-code inputs stay LTR; Latin tokens go last in Arabic strings.
5. **Data.** Generated hooks from `@medibooker/api-client` with TanStack Query. Connect `focusManager` to `AppState` and `onlineManager` to NetInfo. Offline: show cached upcoming appointments read-only with an offline banner; booking and cancelling need a connection. Bookings send an `Idempotency-Key` and handle retries.
6. **Auth.** Tokens only in `expo-secure-store`. Refresh on 401 with a single in-flight refresh. Logout clears secure storage, the query cache and the push token registration. Biometric unlock (`expo-local-authentication`) is optional.
7. **Notifications.** `expo-notifications`. Ask for permission in context (after the first booking), not at app start. Push texts are in the user's locale and contain no health data ("Reminder: your appointment tomorrow at 09:30" / "تذكير: موعدك غدًا الساعة 09:30"). Deep links to an appointment require login and validated parameters. SMS are sent by the server; the app only offers the phone verification (one-time code) and the SMS switches in the notification settings (screen 29).
8. **Calendar.** "Add to calendar" via `expo-calendar`; ask for permission only on tap. The event title does not name the service ("Doctor's appointment – <clinic>").
9. **Privacy.** No third-party analytics or trackers. Consider hiding sensitive screens in the app switcher. No personal data in logs or crash reports.
10. **Navigation and states.** The Android back button behaves predictably. The booking flow keeps its state when going back. Every screen handles loading, empty, error and offline.

## Tests and release

- Jest + React Native Testing Library for components and hooks, with a mocked client or MSW.
- Maestro flows for register → verify → book → cancel, run in CI against preview builds.
- EAS profiles `development`, `preview`, `production`. OTA updates (expo-updates) only for JS-only changes with a matching runtime version. Respect `minimumSupportedVersion` from `/app-config`.

## Checklist

- [ ] Matches Figma (links in the handoff) in light and dark mode, on small and large screens
- [ ] VoiceOver and TalkBack pass; largest text size pass; touch targets ≥ 44 pt
- [ ] Offline and error states; idempotent booking
- [ ] Strings in `ar` and `en`; RTL and LTR checked on iOS and Android; dates/times in the practice time zone
- [ ] No personal data in logs, push texts or calendar entries
- [ ] Lint, typecheck and tests green; Maestro flow passes (commands and results in the handoff)
