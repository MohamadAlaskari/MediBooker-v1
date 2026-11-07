'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ProfileForm } from './profile-form';

/** Screen 23: the same form, from the account page and back to it. */
export function EditDetails(): ReactNode {
  const t = useTranslations('auth.details');
  const locale = useLocale();
  const router = useRouter();
  return (
    <ProfileForm
      personHeading={{ title: t('editTitle') }}
      insuranceHeading={{ title: t('insuranceTitle'), body: t('insuranceBody') }}
      submitLabel={t('save')}
      onSaved={() => {
        router.replace(`/${locale}/account`);
      }}
    />
  );
}
