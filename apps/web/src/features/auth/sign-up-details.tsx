'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useFragmentForLinks } from './fragment';
import { PageHeading } from './form-parts';
import { ProfileForm } from './profile-form';
import { SignUpSteps } from './sign-up-steps';

/** The second step of a sign-up: screens 10 and 11, then on to the e-mail. */
export function SignUpDetails(): ReactNode {
  const t = useTranslations('auth.details');
  const locale = useLocale();
  const router = useRouter();
  const fragment = useFragmentForLinks();
  return (
    <>
      <SignUpSteps current="details" />
      <ProfileForm
        path="/sign-up/details"
        personHeading={<PageHeading title={t('title')} body={t('body')} />}
        insuranceHeading={<PageHeading title={t('insuranceTitle')} body={t('insuranceBody')} />}
        submitLabel={t('continue')}
        onSaved={() => {
          router.replace(`/${locale}/check-inbox${fragment}`);
        }}
      />
    </>
  );
}
