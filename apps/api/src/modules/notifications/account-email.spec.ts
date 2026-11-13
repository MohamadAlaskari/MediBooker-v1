import { describe, expect, it } from 'vitest';
import { isolated, renderAccountEmail } from './account-email.js';

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
      `your account at ${isolated(PRACTICE)}`,
    );
    expect(renderAccountEmail('PASSWORD_RESET', 'ar', WEB, 't', 'مركز النور الطبي').text).toContain(
      'مركز النور الطبي',
    );
    const { html, text } = renderAccountEmail('PASSWORD_RESET', 'en', WEB, 't', '<b>Praxis</b>');
    expect(html).toContain('&lt;b&gt;Praxis&lt;/b&gt;');
    expect(html).not.toContain('MediBooker');
    expect(text).not.toContain('MediBooker');
  });

  it('isolates the name, so that it cannot turn the rest of the line', () => {
    const fsi = String.fromCodePoint(0x2068);
    const pdi = String.fromCodePoint(0x2069);
    const turning = `Praxis ${String.fromCodePoint(0x202e)}xof`;
    const { text, html } = renderAccountEmail('PASSWORD_RESET', 'ar', WEB, 't', turning);
    expect(text).toContain(`${fsi}${turning}${pdi}`);
    expect(html).toContain(`${fsi}${turning}${pdi}`);
  });

  describe('the security e-mails (A04)', () => {
    const AT = Temporal.Instant.from('2026-11-12T10:05:00Z');
    const RIYADH = { timeZone: 'Asia/Riyadh', numberingSystem: 'latn', hourCycle: 'h23' };

    it('tells of a new sign-in: when, as the practice writes it, and with what', () => {
      const email = renderAccountEmail('NEW_SIGN_IN', 'en', WEB, 'the-token', PRACTICE, {
        at: AT,
        device: 'Chrome · Windows',
        ...RIYADH,
      });
      expect(email.subject).toBe('New sign-in to your account');
      expect(email.text).toContain('13:05');
      expect(email.text).toContain('Thursday, November 12, 2026');
      // The device's name is its own claim, and the e-mail says so (the review of A04 part 2b).
      expect(email.text).toContain(`it calls itself ${isolated('Chrome · Windows')}.`);
      expect(email.text).toContain('https://site.example/en/secure-account#token=the-token');
      expect(email.text).toContain('The link is valid for 7 days.');
      expect(email.text).not.toContain('ignore');
    });

    it('says when a device gives no name, and writes Arabic digits where the practice does', () => {
      const email = renderAccountEmail('NEW_SIGN_IN', 'ar', WEB, 't', 'مركز النور الطبي', {
        at: AT,
        device: null,
        ...RIYADH,
        numberingSystem: 'arab',
      });
      expect(email.subject).toBe('تسجيل دخول جديد إلى حسابك');
      expect(email.text).toContain('من قبل، ولا يذكر ما هو.');
      expect(email.text).toContain('١٣:٠٥');
      expect(email.html).toContain('<html lang="ar" dir="rtl">');
      const named = renderAccountEmail('NEW_SIGN_IN', 'ar', WEB, 't', 'مركز النور الطبي', {
        at: AT,
        device: 'Firefox · Android',
        ...RIYADH,
      });
      expect(named.text).toContain(`ويقدّم نفسه على أنه ${isolated('Firefox · Android')}.`);
    });

    it('tells of an authenticator app set up for the account, with the way back', () => {
      const email = renderAccountEmail('SECOND_FACTOR_ENABLED', 'en', WEB, 'the-token', PRACTICE, {
        at: AT,
        ...RIYADH,
      });
      expect(email.subject).toBe('An authenticator app was set up for your account');
      expect(email.text).toContain('13:05');
      expect(email.text).toContain('ask the practice to remove the app');
      expect(email.text).toContain('/en/secure-account#token=the-token');
      expect(email.text).toContain('The link is valid for 7 days.');
      expect(email.text).not.toContain('ignore');
      const arabic = renderAccountEmail('SECOND_FACTOR_ENABLED', 'ar', WEB, 't', PRACTICE, {
        at: AT,
        ...RIYADH,
      });
      expect(arabic.subject).toBe('تم إعداد تطبيق المصادقة لحسابك');
      expect(arabic.text).toContain('/ar/secure-account#token=t');
    });

    it('tells of a new password with the same way back', () => {
      const email = renderAccountEmail('PASSWORD_CHANGED', 'en', WEB, 'the-token', PRACTICE, {
        at: AT,
        ...RIYADH,
      });
      expect(email.subject).toBe('Your password was changed');
      expect(email.text).toContain('13:05');
      expect(email.text).toContain('/en/secure-account#token=the-token');
      expect(email.text).toContain(`your account at ${isolated(PRACTICE)}.`);
    });

    it('keeps the 30 minutes and the hint for strangers on the other e-mails', () => {
      const { text } = renderAccountEmail('PASSWORD_RESET', 'en', WEB, 't', PRACTICE);
      expect(text).toContain('The link is valid for 30 minutes.');
      expect(text).toContain('you can ignore it');
    });
  });

  describe('the notices of the team (E13 to E15, D17)', () => {
    const TEAM = ['TEAM_ROLE_CHANGED', 'TEAM_ACCESS_ENDED', 'TEAM_SECOND_FACTOR_RESET'] as const;

    it('tell what practice management did, without a link, a token or the role', () => {
      for (const template of TEAM) {
        for (const locale of ['ar', 'en']) {
          const { text, html } = renderAccountEmail(template, locale, WEB, undefined, PRACTICE);
          expect(text).toContain(isolated(PRACTICE));
          expect(text).not.toContain(WEB);
          expect(html).not.toContain('<a ');
          expect(html).not.toContain('#token=');
          for (const role of ['STAFF', 'DOCTOR', 'ADMIN', 'MANAGER']) {
            expect(text).not.toContain(role);
          }
        }
      }
    });

    it('say who to ask, in both languages, and the next step after a lost app', () => {
      const reset = renderAccountEmail('TEAM_SECOND_FACTOR_RESET', 'en', WEB, undefined, PRACTICE);
      expect(reset.subject).toBe('The authenticator app was removed from your account');
      expect(reset.text).toContain('you set up an authenticator app again');
      expect(reset.text).toContain('contact the practice at once');
      const ended = renderAccountEmail('TEAM_ACCESS_ENDED', 'ar', WEB, undefined, PRACTICE);
      expect(ended.subject).toBe('انتهى وصولك إلى صفحات فريق العيادة');
      expect(ended.html).toContain('<html lang="ar" dir="rtl">');
    });

    it('refuse a token where there is no link, and a link without a token', () => {
      expect(() => renderAccountEmail('TEAM_ROLE_CHANGED', 'en', WEB, 'a-token', PRACTICE)).toThrow(
        'a token exactly when it has a link',
      );
      expect(() => renderAccountEmail('PASSWORD_RESET', 'en', WEB, undefined, PRACTICE)).toThrow(
        'a token exactly when it has a link',
      );
    });
  });

  it('holds no tracking and loads nothing', () => {
    const { html } = renderAccountEmail('EMAIL_VERIFICATION', 'en', WEB, 't', PRACTICE);
    expect(html).not.toMatch(/<img|<script|<link|url\(/);
  });
});
