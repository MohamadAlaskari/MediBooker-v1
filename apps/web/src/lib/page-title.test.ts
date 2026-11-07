import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES, messages, type Locale } from '@medibooker/i18n';
import { describe, expect, it, vi } from 'vitest';
import { pageTitle } from './page-title';

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: ({ locale }: { readonly locale: Locale }) =>
      Promise.resolve(createTranslator({ locale, messages: messages[locale] })),
  };
});

type TitleKey = Parameters<typeof pageTitle>[0];

const APP = fileURLToPath(new URL('../app/[locale]', import.meta.url));
const ROUTES = readdirSync(APP, { recursive: true, encoding: 'utf8' })
  .filter((file) => ['page.tsx', 'not-found.tsx'].includes(basename(file)))
  .map((file) => ({ file, source: readFileSync(join(APP, file), 'utf8') }));

async function titleOf(key: TitleKey, locale: string): Promise<unknown> {
  const metadata = await pageTitle(key)({ params: Promise.resolve({ locale }) });
  return metadata.title;
}

describe('pageTitle', () => {
  it('writes the text of the page and the product, in the language of the page', async () => {
    await expect(titleOf('portal.list.title', 'en')).resolves.toBe('My appointments · MediBooker');
    await expect(titleOf('portal.list.title', 'ar')).resolves.toBe(
      `${messages.ar.portal.list.title} · MediBooker`,
    );
  });

  it('says nothing for a language that does not exist, which is a 404 anyway', async () => {
    await expect(titleOf('portal.list.title', 'de')).resolves.toBeUndefined();
  });

  it('is on every page, because axe and the tests of a page do not notice its absence', () => {
    const without = ROUTES.filter(({ source }) => !source.includes('generateMetadata')).map(
      ({ file }) => file,
    );
    // The start page is the product itself, which is the title of the root layout.
    expect(without).toEqual(['page.tsx']);
  });

  it.each(LOCALES)('tells the pages apart in %s, with fixed texts only', async (locale) => {
    const keys = ROUTES.map(({ source }) => /pageTitle\('([^']+)'\)/.exec(source)?.[1]).filter(
      (key) => key !== undefined,
    ) as TitleKey[];
    const titles = await Promise.all(keys.map(async (key) => String(await titleOf(key, locale))));
    expect(keys.length).toBeGreaterThanOrEqual(15);
    expect(new Set(titles).size).toBe(titles.length);
    for (const title of titles) expect(title).not.toMatch(/[{}]|\.title/);
  });
});
