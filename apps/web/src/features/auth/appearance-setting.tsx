'use client';

import { useTranslations } from 'next-intl';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Radio, RadioGroup } from '@/components/ui/radio-group';
import { type Theme, themeCookie, themeOf } from '@/lib/theme';

function noChanges(): () => void {
  return () => undefined;
}

/** What the server rendered: it read the cookie (03 §6). */
function shownTheme(): Theme {
  return themeOf(document.documentElement.dataset.theme);
}

/**
 * Light, dark or as the system: kept for this browser in the `theme` cookie, and shown at once
 * (03 §6, B06). A setting of the device, not of the account.
 */
export function AppearanceSetting(): ReactNode {
  const t = useTranslations('auth.account');
  const rendered = useSyncExternalStore(noChanges, shownTheme, () => 'system' as const);
  const [chosen, setChosen] = useState<Theme>();
  return (
    <section className="mb-6 flex flex-col gap-2">
      <h2 className="text-heading-h3 text-text-primary">{t('appearanceTitle')}</h2>
      <RadioGroup
        label={t('appearanceLabel')}
        value={chosen ?? rendered}
        onChange={(value) => {
          const theme = themeOf(value);
          document.cookie = themeCookie(theme, window.location.protocol === 'https:');
          document.documentElement.dataset.theme = theme;
          setChosen(theme);
        }}
      >
        <Radio value="system">{t('themeSystem')}</Radio>
        <Radio value="light">{t('themeLight')}</Radio>
        <Radio value="dark">{t('themeDark')}</Radio>
      </RadioGroup>
    </section>
  );
}
