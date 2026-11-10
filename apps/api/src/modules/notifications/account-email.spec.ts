import { describe, expect, it } from 'vitest';
import { renderAccountEmail } from './account-email.js';

const WEB = 'https://site.example';
const PRACTICE = 'Al Noor Medical Centre';

describe('renderAccountEmail', () => {
  it('writes Arabic right to left, with the link and the token only in its fragment', () => {
    const email = renderAccountEmail('EMAIL_VERIFICATION', 'ar', WEB, 'the-token', PRACTICE);
    expect(email.subject).toBe('يرجى تأكيد بريدك الإلكتروني');
    expect(email.html).toContain('<html lang="ar" dir="rtl">');
    expect(email.html).toContain('href="https://site.example/ar/verify-email#token=the-token"');
    expect(email.text).toContain('https://site.example/ar/verify-email#token=the-token');
  });

  it('writes English left to right', () => {
    const email = renderAccountEmail('PASSWORD_RESET', 'en', WEB, 'the-token', PRACTICE);
    expect(email.subject).toBe('Reset your password');
    expect(email.html).toContain('<html lang="en" dir="ltr">');
    expect(email.html).toContain('https://site.example/en/reset-password#token=the-token');
  });

  it('falls back to the default language for one it does not have', () => {
    expect(renderAccountEmail('PASSWORD_RESET', 'xx', WEB, 't', PRACTICE).html).toContain(
      'lang="ar"',
    );
  });

  it('escapes what goes into the HTML', () => {
    const email = renderAccountEmail('PASSWORD_RESET', 'en', WEB, '"><script>', PRACTICE);
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('speaks in the name of the practice whose account it is (ADR 0016), escaped', () => {
    expect(renderAccountEmail('PASSWORD_RESET', 'en', WEB, 't', PRACTICE).text).toContain(
      'your account at Al Noor Medical Centre',
    );
    expect(renderAccountEmail('PASSWORD_RESET', 'ar', WEB, 't', 'مركز النور الطبي').text).toContain(
      'مركز النور الطبي',
    );
    const { html, text } = renderAccountEmail('PASSWORD_RESET', 'en', WEB, 't', '<b>Praxis</b>');
    expect(html).toContain('&lt;b&gt;Praxis&lt;/b&gt;');
    expect(html).not.toContain('MediBooker');
    expect(text).not.toContain('MediBooker');
  });

  it('holds no tracking and loads nothing', () => {
    const { html } = renderAccountEmail('EMAIL_VERIFICATION', 'en', WEB, 't', PRACTICE);
    expect(html).not.toMatch(/<img|<script|<link|url\(/);
  });
});
