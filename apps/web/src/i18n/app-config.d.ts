import type { formats, Locale, Messages } from '@medibooker/i18n';

// Typed message keys and arguments everywhere (ADR 0013).
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
    Formats: typeof formats;
  }
}
