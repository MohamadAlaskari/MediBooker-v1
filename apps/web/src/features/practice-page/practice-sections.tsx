import type { PublicPracticeDto } from '@medibooker/api-client';
import { isolate } from '@medibooker/i18n';
import { ChevronRight, Globe, Info, Mail, MapPin, Phone, Stethoscope } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { PracticeFormat } from '@/lib/format';
import { fullNameOf, initialsOf, mapsHref, safeHttpsUrl, telHref } from './practice-view';
import { CARD_CLASS, PageSection } from './section';

interface SectionProps {
  readonly practice: PublicPracticeDto;
  readonly format: PracticeFormat;
}

export function ServicesSection({ practice, format }: SectionProps): ReactNode {
  const t = useTranslations('practicePage.services');
  return (
    <PageSection id="services" title={t('title')} subtitle={t('subtitle')}>
      {practice.services.length === 0 ? (
        <p className="text-body-default text-text-secondary">{t('empty')}</p>
      ) : (
        <ul className="grid gap-4 tablet:grid-cols-2 desktop:grid-cols-3">
          {practice.services.map((service) => (
            <li key={service.id} className={`${CARD_CLASS} flex items-start gap-3`}>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-bg-brand-subtle">
                <Stethoscope aria-hidden className="size-5 text-icon-brand" />
              </span>
              <div>
                <h3 className="text-heading-h3 text-text-primary">
                  <bdi>{service.name}</bdi>
                </h3>
                <p className="tabular-times text-body-small text-text-secondary">
                  {t('duration', {
                    count: service.durationMinutes,
                    minutes: format.number(service.durationMinutes),
                  })}
                </p>
                {service.description === null ? null : (
                  <p className="mt-1 text-body-small text-text-secondary">{service.description}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageSection>
  );
}

export function TeamSection({ practice, format }: SectionProps): ReactNode {
  const t = useTranslations('practicePage.team');
  return (
    <PageSection
      id="team"
      title={t('title')}
      subtitle={t('subtitle', { name: isolate(practice.name ?? '') })}
      className="bg-bg-surface"
    >
      {practice.team.length === 0 ? (
        <p className="text-body-default text-text-secondary">{t('empty')}</p>
      ) : (
        <ul className="grid gap-4 tablet:grid-cols-2 desktop:grid-cols-3">
          {practice.team.map((member) => (
            <li
              key={member.id}
              className={`${CARD_CLASS} flex flex-col items-center p-6 text-center`}
            >
              <span
                aria-hidden
                className="flex size-16 items-center justify-center rounded-full bg-bg-brand-muted text-heading-h3 text-text-brand"
              >
                {initialsOf(member)}
              </span>
              <h3 className="mt-3 text-label-large text-text-primary">
                <bdi>{fullNameOf(member)}</bdi>
              </h3>
              {member.specialty === null && member.position === null ? null : (
                <p className="mt-1 text-body-small text-text-secondary">
                  <bdi>{member.specialty ?? member.position}</bdi>
                </p>
              )}
              {member.languages.length === 0 ? null : (
                <p className="mt-2 text-caption text-text-secondary">
                  {format.languages(member.languages)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </PageSection>
  );
}

function ContactRow({
  icon,
  title,
  note,
  href,
  external,
}: {
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly note?: string;
  readonly href?: string;
  readonly external?: boolean;
}): ReactNode {
  const content = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-bg-subtle">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-default text-text-primary">{title}</span>
        {note === undefined ? null : (
          <span className="block text-body-small text-text-secondary">{note}</span>
        )}
      </span>
      {external === true ? (
        <ChevronRight aria-hidden className="size-5 shrink-0 text-icon-secondary rtl:rotate-180" />
      ) : null}
    </>
  );
  const layout = 'flex min-h-touch-target items-center gap-3 py-3';
  return (
    <li className="border-b border-border-subtle last:border-b-0">
      {href === undefined ? (
        <div className={layout}>{content}</div>
      ) : (
        <a
          href={href}
          className={`${layout} hover:bg-bg-subtle`}
          {...(external === true ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {content}
        </a>
      )}
    </li>
  );
}

export function FindUsSection({ practice, format }: SectionProps): ReactNode {
  const t = useTranslations('practicePage.findUs');
  const iconClass = 'size-5 text-icon-secondary';
  return (
    <PageSection id="find-us" title={t('title')}>
      <div className="grid gap-4 desktop:grid-cols-2">
        <div className={`${CARD_CLASS} p-6`}>
          <h3 className="text-heading-h3 text-text-primary">{t('gettingHere')}</h3>
          <ul className="mt-2">
            {practice.address === null ? null : (
              <ContactRow
                icon={<MapPin aria-hidden className={iconClass} />}
                title={<bdi>{practice.address}</bdi>}
                note={t('openInMaps')}
                href={mapsHref(practice.address)}
                external
              />
            )}
            {practice.directions === null ? null : (
              <ContactRow
                icon={<Info aria-hidden className={iconClass} />}
                title={<bdi>{practice.directions}</bdi>}
              />
            )}
          </ul>
        </div>
        <div className={`${CARD_CLASS} p-6`}>
          <h3 className="text-heading-h3 text-text-primary">{t('contact')}</h3>
          <ul className="mt-2">
            {practice.phone === null ? null : (
              <ContactRow
                icon={<Phone aria-hidden className={iconClass} />}
                title={<span dir="ltr">{practice.phone}</span>}
                note={t('phone')}
                href={telHref(practice.phone)}
              />
            )}
            <ContactRow
              icon={<Globe aria-hidden className={iconClass} />}
              title={format.languages(practice.supportedLocales)}
              note={t('languagesSpoken')}
            />
            {practice.email === null ? null : (
              <ContactRow
                icon={<Mail aria-hidden className={iconClass} />}
                title={<span dir="ltr">{practice.email}</span>}
                note={t('emailHint')}
                href={`mailto:${practice.email}`}
              />
            )}
          </ul>
        </div>
      </div>
    </PageSection>
  );
}

export function PracticeFooter({ practice, format }: SectionProps): ReactNode {
  const t = useTranslations('practicePage.footer');
  const legalNotice = safeHttpsUrl(practice.legalNoticeUrl);
  const privacy = safeHttpsUrl(practice.privacyPolicyUrl);
  const linkClass = 'inline-flex min-h-touch-target items-center text-text-brand hover:underline';
  return (
    <footer className="border-t border-border-subtle bg-bg-surface">
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-4 px-4 py-6 text-body-small text-text-secondary">
        <div>
          <p>
            {t('copyright', {
              year: format.year(practice.today),
              name: isolate(practice.name ?? ''),
            })}
          </p>
          <ul className="flex flex-wrap gap-4">
            {legalNotice === undefined ? null : (
              <li>
                <a className={linkClass} href={legalNotice} rel="noopener noreferrer">
                  {t('legalNotice')}
                </a>
              </li>
            )}
            {privacy === undefined ? null : (
              <li>
                <a className={linkClass} href={privacy} rel="noopener noreferrer">
                  {t('privacy')}
                </a>
              </li>
            )}
          </ul>
        </div>
        <p className="flex items-center gap-2">
          {t('bookingWith')}
          <span dir="ltr" className="text-label-large text-logo">
            MediBooker
          </span>
        </p>
      </div>
    </footer>
  );
}
