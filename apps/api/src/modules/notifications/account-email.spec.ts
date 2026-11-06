import { describe, expect, it } from 'vitest';
import { renderAccountEmail } from './account-email.js';

const WEB = 'https://site.example';

describe('renderAccountEmail', () => {
  it('writes Arabic right to left, with the link and the token only in its fragment', () => {
    const email = renderAccountEmail('EMAIL_VERIFICATION', 'ar', WEB, 'the-token');
    expect(email.subject).toBe('يرجى تأكيد بريدك الإلكتروني');
    expect(email.html).toContain('<html lang="ar" dir="rtl">');
    expect(email.html).toContain('href="https://site.example/ar/verify-email#token=the-token"');
    expect(email.text).toContain('https://site.example/ar/verify-email#token=the-token');
  });

  it('writes English left to right', () => {
    const email = renderAccountEmail('PASSWORD_RESET', 'en', WEB, 'the-token');
    expect(email.subject).toBe('Reset your password');
    expect(email.html).toContain('<html lang="en" dir="ltr">');
    expect(email.html).toContain('https://site.example/en/reset-password#token=the-token');
  });

  it('falls back to the default language for one it does not have', () => {
    expect(renderAccountEmail('PASSWORD_RESET', 'xx', WEB, 't').html).toContain('lang="ar"');
  });

  it('escapes what goes into the HTML', () => {
    const email = renderAccountEmail('PASSWORD_RESET', 'en', WEB, '"><script>');
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('holds no tracking and loads nothing', () => {
    const { html } = renderAccountEmail('EMAIL_VERIFICATION', 'en', WEB, 't');
    expect(html).not.toMatch(/<img|<script|<link|url\(/);
  });
});
