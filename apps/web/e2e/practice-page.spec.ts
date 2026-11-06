import { API_STUB_PORT } from './support/ports';
import { expect, test } from './support/test';

const SECTIONS = ['opening-hours', 'free-times', 'services', 'team', 'find-us'];

test.describe('the public practice page (08 P03)', () => {
  test('renders from the API in the language and direction of the path', async ({ page }) => {
    await page.goto('/ar/al-noor');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('مركز النور الطبي');
    await expect(page.getByRole('heading', { name: 'الخدمات' })).toBeVisible();

    await page.goto('/en/al-noor');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Al Noor Medical Centre');
    await expect(page.getByRole('heading', { name: 'Check-up' })).toBeVisible();
    await expect(page.getByText('Open now · until 16:00')).toBeVisible();
    await expect(page.locator('#opening-hours [aria-current="date"]')).toContainText('Today');
  });

  test('has every section, and the language switch goes to the same practice', async ({ page }) => {
    await page.goto('/en/al-noor');
    for (const id of SECTIONS) await expect(page.locator(`#${id}`)).toBeAttached();
    await page.getByRole('link', { name: /العربية/ }).click();
    await expect(page).toHaveURL(/\/ar\/al-noor$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  });

  test('gives everything tappable at least 44 px', async ({ page }) => {
    await page.goto('/en/al-noor');
    for (const link of [
      page.getByRole('link', { name: 'Book appointment' }).first(),
      page.getByRole('link', { name: 'Call us' }),
      page.getByRole('link', { name: /العربية/ }),
      page.getByRole('link', { name: /Open in maps/ }),
    ]) {
      const box = await link.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('shows the skip link on focus, tappable, and it leads to the content', async ({ page }) => {
    await page.goto('/en/al-noor');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    const box = await skip.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
    // not-sr-only resets the padding, so a padding set without focus: would be lost here.
    const padding = await skip.evaluate((link) => getComputedStyle(link).paddingInlineStart);
    expect(padding).not.toBe('0px');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
  });

  test('uses the fonts of the language, from this site', async ({ page }) => {
    const fontOf = async (): Promise<string> =>
      page.locator('h1').evaluate((element) => getComputedStyle(element).fontFamily);
    await page.goto('/ar/al-noor');
    await expect.poll(fontOf).toMatch(/noto/i);
    await page.goto('/en/al-noor');
    await expect.poll(fontOf).toMatch(/inter/i);
  });

  test('sets no cookie and asks no third party', async ({ page, request, baseURL }) => {
    const hosts = new Set<string>();
    page.on('request', (sent) => hosts.add(new URL(sent.url()).host));
    await page.goto('/en/al-noor', { waitUntil: 'networkidle' });
    expect([...hosts]).toEqual([new URL(baseURL ?? '').host]);

    const response = await request.get('/en/al-noor');
    expect(response.headers()['set-cookie']).toBeUndefined();
  });

  test('tells search engines the versions, the canonical address and the facts', async ({
    page,
    baseURL,
  }) => {
    await page.goto('/en/al-noor');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${baseURL ?? ''}/en/al-noor`,
    );
    await expect(page.locator('link[rel="alternate"][hreflang="ar"]')).toHaveAttribute(
      'href',
      `${baseURL ?? ''}/ar/al-noor`,
    );
    const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
    expect(JSON.parse(jsonLd ?? '')).toMatchObject({
      '@type': 'MedicalClinic',
      name: 'Al Noor Medical Centre',
      telephone: '+966 11 000 0000',
      address: { streetAddress: '12 Al Noor Street, Building 4' },
    });
    expect(jsonLd).toContain('openingHoursSpecification');
  });

  test('names every practice in every language in the sitemap, over all pages of the API', async ({
    request,
    baseURL,
  }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('xml');
    const sitemap = await response.text();
    for (const slug of ['al-noor', 'ocean', 'closed']) {
      for (const locale of ['ar', 'en']) {
        expect(sitemap).toContain(`<loc>${baseURL ?? ''}/${locale}/${slug}</loc>`);
      }
    }
    expect(sitemap).toContain('hreflang="ar"');
    expect(sitemap).not.toContain('old-name');
  });

  test('answers 404 for an unknown practice and for a slug that cannot be one', async ({
    request,
  }) => {
    expect((await request.get('/en/nobody')).status()).toBe(404);
    expect((await request.get('/en/UPPER')).status()).toBe(404);
    expect((await request.get('/en/a%2Fb')).status()).toBe(404);
    expect((await request.get('/en/constructor')).status()).toBe(404);
  });

  test('sends a retired slug to the current address for good', async ({ request }) => {
    const response = await request.get('/en/old-name', { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers().location).toMatch(/\/en\/al-noor$/);
  });

  test('says so when one practice is unavailable, with the request id', async ({ page }) => {
    await page.goto('/en/broken');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Something went wrong');
    await expect(page.getByText('30000000-0000-4000-8000-000000000001')).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('passes the address of the visitor on, so the API limits per visitor', async ({
    request,
  }) => {
    const visitor = '203.0.113.7';
    await request.get('/en/al-noor', { headers: { 'X-Forwarded-For': visitor } });
    const seen = await request.get(`http://127.0.0.1:${String(API_STUB_PORT)}/__forwarded-for`);
    expect(await seen.json()).toContain(visitor);
  });

  test('keeps a name in another script out of the sentence around it', async ({ page }) => {
    await page.goto('/en/al-noor');
    const subtitle = await page.locator('#team p').first().textContent();
    expect(subtitle).toBe('The people at ⁨Al Noor Medical Centre⁩.');
  });

  test('shows the hours and the digits of a closed practice in its own zone', async ({ page }) => {
    await page.goto('/en/closed');
    await expect(page.getByText(/Closed now · opens Monday at ٠٨:٠٠/)).toBeVisible();
  });

  test('leaves out what a practice hides', async ({ page }) => {
    await page.goto('/en/hidden');
    await expect(page.locator('#opening-hours')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Opening hours' })).toHaveCount(0);
  });
});

test.describe('the theme of a practice', () => {
  const brandColor = (element: Element): string =>
    getComputedStyle(element).getPropertyValue('--brand-600').trim();
  const canvasColor = (element: Element): string =>
    getComputedStyle(element).getPropertyValue('--gray-50').trim();

  test('a preset changes the brand and nothing else', async ({ page }) => {
    await page.goto('/en/al-noor');
    const teal = await page.locator('html').evaluate(brandColor);
    const canvas = await page.locator('html').evaluate(canvasColor);
    await page.goto('/en/ocean');
    expect(await page.locator('html').evaluate(brandColor)).not.toBe(teal);
    expect(await page.locator('html').evaluate(canvasColor)).toBe(canvas);
  });

  test('a custom colour reaches the page', async ({ page }) => {
    await page.goto('/en/custom');
    expect(await page.locator('html').evaluate(brandColor)).toBe('#7a1f5c');
  });
});

test.describe('hostile text from a practice', () => {
  test('stays text: no script runs, no link goes to javascript', async ({ page }) => {
    await page.goto('/en/hostile');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('</script>');
    expect(await page.evaluate(() => 'pwned' in window)).toBe(false);
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
    const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
    expect(JSON.parse(jsonLd ?? '')).toMatchObject({
      name: '</script><script>window.pwned = true</script>',
    });
    const brand = await page
      .locator('html')
      .evaluate((element) => getComputedStyle(element).getPropertyValue('--brand-600').trim());
    expect(brand).toBe('#0b7a6e');
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('every section is there and visible', async ({ page }) => {
    await page.goto('/en/al-noor');
    for (const id of SECTIONS) await expect(page.locator(`#${id}`)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Check-up' })).toBeVisible();
  });
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('sections are in their end state at once', async ({ page }) => {
    await page.goto('/en/al-noor', { waitUntil: 'networkidle' });
    const section = page.locator('#find-us > div');
    expect(await section.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  });
});

test.describe('when printed', () => {
  test('shows the sections below the fold too', async ({ page }) => {
    await page.goto('/en/al-noor', { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    const section = page.locator('#find-us > div');
    await expect
      .poll(() => section.evaluate((element) => getComputedStyle(element).opacity))
      .toBe('1');
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('long Arabic text does not make the page wider than the screen', async ({ page }) => {
    await page.goto('/ar/long-arabic');
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  });
});
