'use client';

import {
  isApiError,
  useGetProfile,
  useJoinPractice,
  useListMyPatients,
  useUpdateMyPatient,
  type PublicPracticeDto,
} from '@medibooker/api-client';
import { isolateLtr, PRIVACY_NOTICE_VERSION } from '@medibooker/i18n';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeading, TEXT_LINK, useFocusOnArrival } from '../auth/form-parts';
import {
  DetailsSteps,
  INSURANCE_TYPES,
  type InsuranceType,
  type PracticeAsks,
} from '../auth/profile-form';
import { nameInSentence } from './appointment-view';
import { LoadError, Loading } from './portal-parts';

const CONSENT_FIELD = 'privacyNoticeVersion';

function typesOf(practice: PublicPracticeDto): readonly InsuranceType[] {
  return INSURANCE_TYPES.filter((type) => practice.insuranceTypes.includes(type));
}

function asksOf(practice: PublicPracticeDto): PracticeAsks {
  return {
    providerTypes: practice.insuranceProviderTypes,
    numberTypes: practice.insuranceNumberTypes,
  };
}

interface StepProps {
  readonly practice: PublicPracticeDto;
  readonly onDone: () => void;
}

interface JoinStepProps extends StepProps {
  /** A press brought the person here: the first heading takes the focus. */
  readonly focusOnArrival?: boolean;
}

/**
 * The first booking at a practice (B01, RT-92): shows what goes to the practice before anything does,
 * from the account's details, to change for this practice alone. What is sent is what is shown: a
 * cleared phone goes as none, because left out the API would copy the account's. A notice is asked
 * for only when the account has not agreed to the current one yet, as the API says.
 */
export function JoinStep({ practice, focusOnArrival = false, onDone }: JoinStepProps): ReactNode {
  const t = useTranslations('portal');
  const locale = useLocale();
  const profile = useGetProfile();
  const join = useJoinPractice();
  const [asksConsent, setAsksConsent] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [consentMissing, setConsentMissing] = useState(false);
  const [retried, setRetried] = useState(false);
  const consentBox = useFocusOnArrival<HTMLInputElement>(consentMissing);
  const name = nameInSentence(practice.name, t('list.somePractice'));
  if (profile.isPending) return <Loading>{t('book.loading')}</Loading>;
  const notEntered = isApiError(profile.error) && profile.error.status === 404;
  // Only when there is nothing to show: a failed look for changes must not take away what was typed.
  if (profile.data === undefined && !notEntered) {
    return (
      <>
        <PageHeading title={t('join.title', { practice: name })} />
        <LoadError
          query={profile}
          onPassed={() => {
            setRetried(true);
          }}
        />
      </>
    );
  }
  return (
    <DetailsSteps
      known={profile.data}
      types={typesOf(practice)}
      asks={asksOf(practice)}
      knownNumberHint={(end) => t('join.numberGoes', { end: isolateLtr(end), practice: name })}
      focusOnArrival={focusOnArrival || retried}
      personHeading={{
        title: t('join.title', { practice: name }),
        body: t('join.body', { practice: name }),
      }}
      insuranceHeading={{
        title: t('join.insuranceTitle', { practice: name }),
        body: t('join.insuranceBody'),
      }}
      submitLabel={t('join.submit')}
      otherFields={[CONSENT_FIELD]}
      beforeSubmit={
        asksConsent ? (
          <div className="flex flex-col gap-1">
            <Checkbox
              isSelected={accepted}
              onChange={setAccepted}
              inputRef={consentBox}
              error={consentMissing && !accepted ? t('join.consentRequired') : undefined}
            >
              {t('join.consent')}
            </Checkbox>
            <a href={`/${locale}/privacy`} target="_blank" rel="noreferrer" className={TEXT_LINK}>
              {t('join.consentLink')}
            </a>
          </div>
        ) : null
      }
      saving={{
        send: (data, { onError, onSuccess }) => {
          if (asksConsent && !accepted) {
            setConsentMissing(true);
            // The second time nothing changes for the hook.
            consentBox.current?.focus();
            return;
          }
          join.mutate(
            {
              practiceId: practice.id,
              data: {
                ...data,
                phone: data.phone ?? null,
                ...(asksConsent ? { privacyNoticeVersion: PRIVACY_NOTICE_VERSION } : {}),
              },
            },
            {
              onSuccess,
              onError: (failure) => {
                // From another tab, for instance: the person is there, which is all this step is for.
                if (failure.code === 'ALREADY_JOINED') {
                  onSuccess();
                  return;
                }
                if (failure.fieldErrors.some(({ field }) => field === CONSENT_FIELD)) {
                  // Says why at once, on a box that arrives only now: nothing else on the page changes.
                  setAsksConsent(true);
                  setConsentMissing(true);
                }
                onError(failure);
              },
            },
          );
        },
        isPending: join.isPending,
        error: join.error,
      }}
      onSaved={onDone}
    />
  );
}

/**
 * When a practice now asks for more than a profile has (BR-09): the own details there, then on. A press
 * on a time brought the person here, so its heading takes the focus.
 */
export function UpdateDetailsStep({ practice, onDone }: StepProps): ReactNode {
  const t = useTranslations('portal');
  const patients = useListMyPatients(practice.id);
  const update = useUpdateMyPatient();
  const patient = patients.data?.items[0];
  const name = nameInSentence(practice.name, t('list.somePractice'));
  if (patients.isPending) return <Loading>{t('book.loading')}</Loading>;
  if (patient === undefined) {
    return (
      <>
        <PageHeading title={t('join.updateTitle', { practice: name })} focusOnArrival />
        <LoadError query={patients} />
      </>
    );
  }
  return (
    <DetailsSteps
      known={patient}
      types={typesOf(practice)}
      asks={asksOf(practice)}
      focusOnArrival
      personHeading={{
        title: t('join.updateTitle', { practice: name }),
        body: t('join.updateBody'),
      }}
      insuranceHeading={{
        title: t('join.insuranceTitle', { practice: name }),
        body: t('join.insuranceBody'),
      }}
      submitLabel={t('join.updateSubmit')}
      saving={{
        send: (data, handlers) => {
          update.mutate(
            {
              practiceId: practice.id,
              patientId: patient.id,
              // Left out, the one the practice holds would stay.
              data: { ...data, phone: data.phone ?? null },
            },
            handlers,
          );
        },
        isPending: update.isPending,
        error: update.error,
      }}
      onSaved={onDone}
    />
  );
}
