import { messages, type Locale } from '@medibooker/i18n';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { useLocale } from 'react-aria-components';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthProviders } from './auth-providers';

function WhatReactAriaFollows(): ReactNode {
  const { locale, direction } = useLocale();
  return `${locale} ${direction}`;
}

describe('AuthProviders', () => {
  // The hidden dismiss button of a dialog is named by this, and tabs read their arrow keys from it.
  it.each<[Locale, string]>([
    ['ar', 'ar rtl'],
    ['en', 'en ltr'],
  ])('gives React Aria the language of the page on /%s, not the browser’s', (locale, expected) => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale={locale} messages={messages[locale]}>
        <AuthProviders>
          <WhatReactAriaFollows />
        </AuthProviders>
      </NextIntlClientProvider>,
    );
    expect(html).toBe(expected);
  });
});
