import { messages } from '@medibooker/i18n';
import { localeOf, newAddress, signedIn } from './support/journey';
import { expect, test } from './support/test';

/** The installation's practice of the browser tests, al-noor (ADR 0016), as the stub names it. */
const NAME = { ar: 'مركز النور الطبي', en: 'Al Noor Medical Centre' } as const;

test.describe("the practice's brand (08 I02)", () => {
  test('frames the ways in by its name, with a small note on whose software it is', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { auth, common } = messages[locale];
    await page.goto(`/${locale}/sign-in`);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByText(NAME[locale]).first()).toBeVisible();
    await expect(page.getByRole('contentinfo')).toHaveText(
      common.poweredBy.replace('{product}', 'MediBooker'),
    );
    await expect(page).toHaveTitle(`${auth.signIn.title} · ${NAME[locale]}`);
    // Its colours too: the document's head carries them, as on the practice's own page.
    const colours = await page.evaluate(() =>
      [...document.head.querySelectorAll('style')].some((style) =>
        style.textContent.includes('--brand-600'),
      ),
    );
    expect(colours).toBe(true);
  });

  test('frames the signed-in pages by its name, and nothing names MediBooker but the note', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const { common, portal } = messages[locale];
    await signedIn(page, locale, newAddress(testInfo));
    await expect(page.getByRole('banner')).toContainText(NAME[locale]);
    await expect(page.getByRole('banner')).not.toContainText('MediBooker');
    await expect(page.getByRole('contentinfo')).toHaveText(
      common.poweredBy.replace('{product}', 'MediBooker'),
    );
    await expect(page).toHaveTitle(`${portal.list.title} · ${NAME[locale]}`);
  });

  test('names the practice alone in the title of its own page', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);
    await page.goto(`/${locale}`);
    const title = await page.title();
    expect(title).toContain(NAME[locale]);
    expect(title.split(NAME[locale])).toHaveLength(2);
  });
});
