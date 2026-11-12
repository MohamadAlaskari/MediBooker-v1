import { createColorTheme } from '@medibooker/design-tokens';
import { DEFAULT_LOCALE, getDirection, isLocale, messages } from '@medibooker/i18n';
import { createTranslator } from 'use-intl/core';
import type { AccountNotificationTemplate } from '../../generated/platform/enums.js';

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

interface TemplateTexts {
  /** The namespace of its texts. */
  readonly texts: 'verify' | 'reset' | 'newSignIn' | 'passwordChanged' | 'secondFactorEnabled';
  /** The page its link leads to. */
  readonly page: string;
  /** How long its link works: the 30 minutes of ADR 0004 §8, or the week of a security link. */
  readonly validity: 'validity' | 'validityDays';
  /** A security e-mail: its footer does not tell a stranger to ignore it. */
  readonly security: boolean;
}

const TEMPLATES: Readonly<Record<AccountNotificationTemplate, TemplateTexts>> = {
  EMAIL_VERIFICATION: {
    texts: 'verify',
    page: 'verify-email',
    validity: 'validity',
    security: false,
  },
  PASSWORD_RESET: { texts: 'reset', page: 'reset-password', validity: 'validity', security: false },
  NEW_SIGN_IN: {
    texts: 'newSignIn',
    page: 'secure-account',
    validity: 'validityDays',
    security: true,
  },
  PASSWORD_CHANGED: {
    texts: 'passwordChanged',
    page: 'secure-account',
    validity: 'validityDays',
    security: true,
  },
  SECOND_FACTOR_ENABLED: {
    texts: 'secondFactorEnabled',
    page: 'secure-account',
    validity: 'validityDays',
    security: true,
  },
};

/** The e-mails that say when something happened to the account, with the way back (A04). */
export function isSecurityTemplate(template: AccountNotificationTemplate): boolean {
  return TEMPLATES[template].security;
}

/** What a security e-mail tells: when, with what, and how the practice writes a time (A04). */
export interface AccountEmailDetails {
  /** The sign-in of E10, the new password, or the app put in force. */
  readonly at: Temporal.Instant;
  /** E10: the browser or app and system, coarse; null when unknown. */
  readonly device?: string | null;
  readonly timeZone: string;
  readonly numberingSystem: string;
  readonly hourCycle: string;
}

/** A time as the practice writes it: its zone, its digits, its hours, in the account's language. */
function written(locale: string, details: AccountEmailDetails): string {
  const tag = `${locale}-u-nu-${details.numberingSystem}-hc-${details.hourCycle}`;
  return new Intl.DateTimeFormat(tag, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: details.timeZone,
  }).format(details.at.epochMilliseconds);
}

/** FIRST STRONG ISOLATE and POP DIRECTIONAL ISOLATE, as numbers: no such character in this file. */
const FSI = String.fromCodePoint(0x2068);
const PDI = String.fromCodePoint(0x2069);

/**
 * A name the practice chose, isolated from the sentence around it: Latin in Arabic and the other
 * way round keep their order, and the name cannot turn the rest of the line (the security review
 * of A04 part 2a).
 */
export function isolated(text: string): string {
  return `${FSI}${text}${PDI}`;
}

function escaped(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * An account e-mail, rendered when it is sent, in the language of the account: RTL HTML and plain
 * text, inline colours and no tracking. The link names the token in its fragment, so it reaches no
 * server log (03 §7). The caller passes a link from PUBLIC_WEB_URL, never from a request, and the
 * name of the practice whose account it is (ADR 0016). A security e-mail (A04) also says when, and
 * with what device, isolated from the sentence around it.
 */
export function renderAccountEmail(
  template: AccountNotificationTemplate,
  accountLocale: string,
  webUrl: string,
  token: string,
  practiceName: string,
  details?: AccountEmailDetails,
): RenderedEmail {
  const locale = isLocale(accountLocale) ? accountLocale : DEFAULT_LOCALE;
  const { texts, page, validity: validityText, security } = TEMPLATES[template];
  const t = createTranslator({ locale, messages: messages[locale], namespace: 'emails' });
  const link = `${webUrl}/${locale}/${page}#token=${token}`;
  const subject = t(`${texts}.subject`);
  const heading = t(`${texts}.heading`);
  // The client names itself, and anyone can send any name: E10 says so (the review of A04 part 2b).
  const deviceName = details?.device;
  const body = t(`${texts}.body`, {
    when: details === undefined ? '' : isolated(written(locale, details)),
    device:
      deviceName === undefined || deviceName === null
        ? t('unknownDevice')
        : t('deviceNamed', { name: isolated(deviceName) }),
  });
  const action = t(`${texts}.action`);
  const validity = t(validityText);
  const footer = t(security ? 'footerSecurity' : 'footer', { practice: isolated(practiceName) });
  const { bg, text } = createColorTheme('light');
  const direction = getDirection(locale);
  const paragraph = `margin:0 0 16px;font:16px/24px sans-serif;color:${text.secondary}`;
  return {
    subject,
    text: [heading, '', body, '', link, '', validity, '', footer].join('\n'),
    html: `<!doctype html>
<html lang="${locale}" dir="${direction}">
<body style="margin:0;padding:24px;background:${bg.canvas}">
<div style="max-width:560px;margin:0 auto;padding:24px;background:${bg.surface};border-radius:12px;text-align:start">
<h1 style="margin:0 0 16px;font:bold 24px/32px sans-serif;color:${text.primary}">${escaped(heading)}</h1>
<p style="${paragraph}">${escaped(body)}</p>
<p style="margin:0 0 16px"><a href="${escaped(link)}" style="display:inline-block;padding:12px 24px;background:${bg.brand};color:${text.onBrand};border-radius:8px;font:bold 16px/24px sans-serif;text-decoration:none">${escaped(action)}</a></p>
<p style="${paragraph}">${escaped(validity)}</p>
<p style="margin:0;font:12px/18px sans-serif;color:${text.secondary}">${escaped(footer)}</p>
</div>
</body>
</html>
`,
  };
}
