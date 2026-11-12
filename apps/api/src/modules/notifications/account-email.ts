import { createColorTheme } from '@medibooker/design-tokens';
import { DEFAULT_LOCALE, getDirection, isLocale, messages } from '@medibooker/i18n';
import { createTranslator } from 'use-intl/core';
import type { AccountNotificationTemplate } from '../../generated/platform/enums.js';

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** The namespace of each template's texts, and the page its link leads to. */
const TEMPLATES: Readonly<
  Record<AccountNotificationTemplate, { readonly texts: 'verify' | 'reset'; readonly page: string }>
> = {
  EMAIL_VERIFICATION: { texts: 'verify', page: 'verify-email' },
  PASSWORD_RESET: { texts: 'reset', page: 'reset-password' },
};

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
 * name of the practice whose account it is (ADR 0016).
 */
export function renderAccountEmail(
  template: AccountNotificationTemplate,
  accountLocale: string,
  webUrl: string,
  token: string,
  practiceName: string,
): RenderedEmail {
  const locale = isLocale(accountLocale) ? accountLocale : DEFAULT_LOCALE;
  const { texts, page } = TEMPLATES[template];
  const t = createTranslator({ locale, messages: messages[locale], namespace: 'emails' });
  const link = `${webUrl}/${locale}/${page}#token=${token}`;
  const subject = t(`${texts}.subject`);
  const heading = t(`${texts}.heading`);
  const body = t(`${texts}.body`);
  const action = t(`${texts}.action`);
  const validity = t('validity');
  const footer = t('footer', { practice: isolated(practiceName) });
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
