import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { encode } from 'uqr';
import { modulePath, QrCode } from './qr-code';

describe('modulePath', () => {
  it('draws one square of one module for each dark module, inside the quiet zone', () => {
    expect(
      modulePath([
        [true, false],
        [false, true],
      ]),
    ).toBe('M4 4h1v1h-1zM5 5h1v1h-1z');
    expect(modulePath([[false]])).toBe('');
  });
});

describe('QrCode', () => {
  const URI =
    'otpauth://totp/Practice:staff%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Practice';

  it('is an image with a name, sized by its modules and four of quiet zone on each side', () => {
    const html = renderToStaticMarkup(<QrCode text={URI} label="QR code for your app" />);
    const side = encode(URI, { ecc: 'M', border: 0 }).size + 8;
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="QR code for your app"');
    expect(html).toContain(`viewBox="0 0 ${String(side)} ${String(side)}"`);
  });

  it('takes its colours from tokens, dark on light also in the dark scheme, without a style', () => {
    const html = renderToStaticMarkup(<QrCode text={URI} label="QR" />);
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain('dark:bg-bg-inverse');
    expect(html).toContain('dark:text-text-inverse');
    expect(html).not.toContain('style=');
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});
