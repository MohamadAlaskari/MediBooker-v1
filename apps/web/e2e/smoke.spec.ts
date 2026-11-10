import { expect, test } from './support/test';

test.describe('the web skeleton (08 F06)', () => {
  test('renders Arabic right to left and English left to right, from the path', async ({
    page,
  }) => {
    // The root is the page of the installation's practice (ADR 0016), in the language of the path.
    await page.goto('/ar');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('مركز النور الطبي');

    await page.goto('/en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Al Noor Medical Centre');
  });

  test('sends a path without a locale to the language of the visitor', async ({ request }) => {
    const toEnglish = await request.get('/', {
      headers: { 'Accept-Language': 'en' },
      maxRedirects: 0,
    });
    expect(toEnglish.status()).toBe(307);
    expect(toEnglish.headers().location).toMatch(/\/en$/);

    const toArabic = await request.get('/', {
      headers: { 'Accept-Language': 'de' },
      maxRedirects: 0,
    });
    expect(toArabic.status()).toBe(307);
    expect(toArabic.headers().location).toMatch(/\/ar$/);
  });

  test('answers 404 for a language it lacks', async ({ request }) => {
    expect((await request.get('/de')).status()).toBe(404);
  });

  test('gives every page a new nonce, strict headers and no cookie', async ({ request }) => {
    const first = await request.get('/ar');
    const second = await request.get('/ar');
    const nonceOf = (csp: string | undefined): string | undefined =>
      /'nonce-([^']+)'/.exec(csp ?? '')?.[1];
    const firstCsp = first.headers()['content-security-policy'];
    expect(nonceOf(firstCsp)).toBeDefined();
    expect(nonceOf(second.headers()['content-security-policy'])).not.toBe(nonceOf(firstCsp));
    expect(/script-src [^;]*/.exec(firstCsp ?? '')?.[0]).not.toContain('unsafe-inline');
    expect(first.headers()['strict-transport-security']).toContain('max-age=');
    expect(first.headers()['cross-origin-opener-policy']).toBe('same-origin');
    expect(first.headers()['set-cookie']).toBeUndefined();
    expect(first.headers()['x-powered-by']).toBeUndefined();
  });

  test('gives a path with a dot or a look-alike of an excluded path the policy and a 404', async ({
    request,
  }) => {
    for (const path of ['/en/foo.bar', '/en/x.png', '/en/apifoo', '/en/healthzfoo']) {
      const response = await request.get(path, { headers: { 'x-nonce': 'chosen-by-the-visitor' } });
      expect(response.status()).toBe(404);
      expect(response.headers()['content-security-policy']).toContain("'nonce-");
      expect(await response.text()).not.toContain('chosen-by-the-visitor');
    }
  });

  test('keeps search engines out of the API and shows them the sitemap', async ({
    request,
    baseURL,
  }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Disallow: /api/');
    expect(robots).toContain(`Sitemap: ${baseURL ?? ''}/sitemap.xml`);
  });

  test('answers the container probe', async ({ request }) => {
    const response = await request.get('/healthz');
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});
