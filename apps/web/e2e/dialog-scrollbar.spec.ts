import { messages } from '@medibooker/i18n';
import { booked, localeOf, newAddress, rowsOf, toList } from './support/journey';
import { expect, test } from './support/test';

// In a file of its own: the browser needs the scrollbars Playwright hides, for all its tests.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test('dragging the scrollbar of a dialog taller than the window does not close it', async ({
  page,
}, testInfo) => {
  const locale = localeOf(testInfo);
  const { portal } = messages[locale];
  await booked(page, locale, newAddress(testInfo));
  await toList(page, locale);
  await page.setViewportSize({ width: 320, height: 256 });
  await rowsOf(page, locale).getByRole('button', { name: portal.list.cancel }).click();
  const dialog = page.getByRole('dialog', { name: portal.cancel.title });
  await expect(dialog).toBeVisible();

  const place = await dialog.evaluate((element) => {
    let overlay = element.parentElement;
    while (overlay !== null && getComputedStyle(overlay).overflowY !== 'auto') {
      overlay = overlay.parentElement;
    }
    if (overlay === null) return undefined;
    overlay.dataset.scroller = '';
    const { left, right, top } = overlay.getBoundingClientRect();
    const width = overlay.offsetWidth - overlay.clientWidth;
    // A right-to-left box has it on the left.
    return { x: overlay.clientLeft > 0 ? left + width / 2 : right - width / 2, top, width };
  });
  test.skip(place?.width === 0, 'This platform draws its scrollbars over the content');
  const x = place?.x ?? 0;
  const y = (place?.top ?? 0) + 30;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 60, { steps: 5 });
  await page.mouse.up();

  await expect(dialog).toBeVisible();
  const scrolled = await page.locator('[data-scroller]').evaluate((overlay) => overlay.scrollTop);
  expect(scrolled, 'the drag moved the dialog').toBeGreaterThan(0);
  await dialog.getByRole('button', { name: portal.cancel.keep }).click();
  await expect(dialog).toHaveCount(0);
});
