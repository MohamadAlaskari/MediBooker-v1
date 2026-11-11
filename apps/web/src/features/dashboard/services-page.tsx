'use client';

import {
  isApiError,
  useCreateService,
  useListServices,
  useUpdateService,
  type ServiceDto,
  type ServiceListDto,
} from '@medibooker/api-client';
import { getDirection, isolate, isLocale } from '@medibooker/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Info, Pencil, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Label } from 'react-aria-components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tab, TabList, TabPanel, Tabs } from '@/components/ui/tabs';
import { TextAreaField, TextField } from '@/components/ui/text-field';
import { practiceFormat } from '@/lib/format';
import { FormError } from '../auth/form-parts';
import { textIn } from '../portal/appointment-view';
import { useDesk } from './desk-context';
import { buffersWith, durationsWith, isPracticeQueryOf, languageName } from './setup-view';

/** As long as the API takes them. */
const NAME_MAX = 80;
const NOTE_MAX = 500;
const LABEL = 'text-label-default text-text-primary';

type InsuranceType = ServiceListDto['insuranceTypes'][number];

interface FormState {
  readonly names: Readonly<Record<string, string>>;
  readonly notes: Readonly<Record<string, string>>;
  readonly duration: number;
  readonly buffer: number;
  readonly online: boolean;
  readonly referral: boolean;
  readonly insurance: readonly InsuranceType[];
}

function stateOf(service: ServiceDto | undefined, taken: readonly InsuranceType[]): FormState {
  if (service === undefined) {
    return {
      names: {},
      notes: {},
      duration: 30,
      buffer: 0,
      online: true,
      referral: false,
      insurance: taken,
    };
  }
  const allowed = service.allowedInsuranceTypes;
  return {
    names: service.name,
    notes: service.description,
    duration: service.durationMinutes,
    buffer: service.bufferMinutes,
    online: service.isBookableOnline,
    referral: service.referralRequired,
    insurance: allowed.length === 0 ? taken : taken.filter((type) => allowed.includes(type)),
  };
}

/** W13: the texts per language, the duration, who it is for and whether patients book it online. */
function ServiceForm({
  service,
  list,
  onSaved,
  onCancel,
}: {
  readonly service: ServiceDto | undefined;
  readonly list: ServiceListDto;
  readonly onSaved: (news: string) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const t = useTranslations('dashboard.serviceForm');
  const news = useTranslations('dashboard.services');
  const locale = useLocale();
  const { practiceId } = useDesk();
  const queryClient = useQueryClient();
  const format = practiceFormat(locale, list);
  const [state, setState] = useState(() => stateOf(service, list.insuranceTypes));
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [tab, setTab] = useState(list.locales.includes(locale) ? locale : (list.locales[0] ?? ''));
  const settled = {
    onSettled: () =>
      queryClient.invalidateQueries({
        predicate: ({ queryKey }) => isPracticeQueryOf(practiceId, queryKey),
      }),
  };
  const create = useCreateService({ mutation: settled });
  const update = useUpdateService({ mutation: settled });
  const archive = useUpdateService({ mutation: settled });
  const pending = create.isPending || update.isPending || archive.isPending;
  const error = create.error ?? update.error ?? archive.error;
  const nameOf = (texts: Readonly<Record<string, string>>): string =>
    isolate(textIn(texts, locale).trim());

  const messageOf = (code: string, max: number): string =>
    code === 'REQUIRED'
      ? t('nameMissing')
      : code === 'TOO_LONG'
        ? t('textTooLong', { max: format.number(max) })
        : t('textInvalid');

  const show = (found: Readonly<Record<string, string>>): void => {
    setErrors(found);
    // A text of a language whose tab is hidden: its tab opens, so that the error can be seen.
    const first = list.locales.find(
      (code) => found[`name.${code}`] !== undefined || found[`description.${code}`] !== undefined,
    );
    if (first !== undefined) setTab(first);
  };

  const refused = (failure: unknown): void => {
    if (!isApiError(failure)) return;
    const found: Record<string, string> = {};
    for (const { field, code } of failure.fieldErrors) {
      if (field.startsWith('name.')) found[field] = messageOf(code, NAME_MAX);
      else if (field.startsWith('description.')) found[field] = messageOf(code, NOTE_MAX);
    }
    show(found);
  };

  const submit = (): void => {
    const found: Record<string, string> = {};
    for (const code of list.locales) {
      if ((state.names[code] ?? '').trim() === '') found[`name.${code}`] = t('nameMissing');
    }
    if (state.insurance.length === 0) found.allowedInsuranceTypes = t('insuranceNone');
    show(found);
    if (Object.keys(found).length > 0) return;
    const everyType = list.insuranceTypes.every((type) => state.insurance.includes(type));
    const data = {
      name: state.names,
      description: state.notes,
      durationMinutes: state.duration,
      bufferMinutes: state.buffer,
      referralRequired: state.referral,
      isBookableOnline: state.online,
      allowedInsuranceTypes: everyType ? [] : [...state.insurance],
    };
    if (service === undefined) {
      create.mutate(
        { practiceId, data },
        {
          onSuccess: (created) => {
            onSaved(news('added', { service: nameOf(created.name) }));
          },
          onError: refused,
        },
      );
    } else {
      update.mutate(
        { practiceId, serviceId: service.id, data },
        {
          onSuccess: (saved) => {
            onSaved(news('saved', { service: nameOf(saved.name) }));
          },
          onError: refused,
        },
      );
    }
  };

  const shownFields = Object.keys(errors);
  const onlineHintId = useId();
  const bufferHintId = useId();
  const referralHintId = useId();
  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <FormError error={error} fields={shownFields} />
      <Tabs
        selectedKey={tab}
        onSelectionChange={(key) => {
          setTab(String(key));
        }}
      >
        <TabList aria-label={t('languages')}>
          {list.locales.map((code) => (
            <Tab key={code} id={code}>
              <span lang={code}>{languageName(code)}</span>
            </Tab>
          ))}
        </TabList>
        {list.locales.map((code) => {
          const dir = isLocale(code) ? getDirection(code) : undefined;
          return (
            <TabPanel key={code} id={code}>
              <div className="flex flex-col gap-4">
                <TextField
                  label={t('name')}
                  value={state.names[code] ?? ''}
                  onChange={(value) => {
                    setState({ ...state, names: { ...state.names, [code]: value } });
                  }}
                  maxLength={NAME_MAX}
                  isRequired
                  lang={code}
                  {...(dir === undefined ? {} : { dir })}
                  error={errors[`name.${code}`]}
                />
                <TextAreaField
                  label={t('note')}
                  hint={t('noteHint')}
                  value={state.notes[code] ?? ''}
                  onChange={(value) => {
                    setState({ ...state, notes: { ...state.notes, [code]: value } });
                  }}
                  maxLength={NOTE_MAX}
                  lang={code}
                  {...(dir === undefined ? {} : { dir })}
                  error={errors[`description.${code}`]}
                />
              </div>
            </TabPanel>
          );
        })}
      </Tabs>
      <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
        <Select
          value={state.duration}
          onChange={(key) => {
            if (key !== null) setState({ ...state, duration: Number(key) });
          }}
        >
          <Label className={LABEL}>{t('duration')}</Label>
          <SelectTrigger className="mt-2" />
          <SelectContent>
            {durationsWith(state.duration).map((minutes) => (
              <SelectItem key={minutes} id={minutes}>
                {news('minutes', { minutes: format.number(minutes) })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-col gap-1">
          <Select
            value={state.buffer}
            onChange={(key) => {
              if (key !== null) setState({ ...state, buffer: Number(key) });
            }}
            aria-describedby={bufferHintId}
          >
            <Label className={LABEL}>{t('buffer')}</Label>
            <SelectTrigger className="mt-2" />
            <SelectContent>
              {buffersWith(state.buffer).map((minutes) => (
                <SelectItem key={minutes} id={minutes}>
                  {minutes === 0
                    ? t('bufferNone')
                    : news('minutes', { minutes: format.number(minutes) })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id={bufferHintId} className="text-body-small text-text-secondary">
            {t('bufferHint')}
          </p>
        </div>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className={LABEL}>{t('insurance')}</legend>
        <p className="text-body-small text-text-secondary">{t('insuranceHint')}</p>
        <div className="flex flex-wrap gap-x-6">
          {list.insuranceTypes.map((type) => (
            <Checkbox
              key={type}
              isSelected={state.insurance.includes(type)}
              onChange={(chosen) => {
                setState({
                  ...state,
                  insurance: chosen
                    ? list.insuranceTypes.filter(
                        (each) => each === type || state.insurance.includes(each),
                      )
                    : state.insurance.filter((each) => each !== type),
                });
              }}
            >
              {t('insuranceType', { type })}
            </Checkbox>
          ))}
        </div>
        {errors.allowedInsuranceTypes === undefined ? null : (
          <p role="alert" className="text-body-small text-text-danger">
            {errors.allowedInsuranceTypes}
          </p>
        )}
      </fieldset>
      <div className="flex flex-col gap-1">
        <Switch
          isSelected={state.online}
          onChange={(online) => {
            setState({ ...state, online });
          }}
          aria-describedby={onlineHintId}
        >
          {t('online')}
        </Switch>
        <p id={onlineHintId} className="text-body-small text-text-secondary">
          {t('onlineHint')}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <Checkbox
          isSelected={state.referral}
          onChange={(referral) => {
            setState({ ...state, referral });
          }}
          aria-describedby={referralHintId}
        >
          {t('referral')}
        </Checkbox>
        <p id={referralHintId} className="text-body-small text-text-secondary">
          {t('referralHint')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4">
        {service === undefined ? null : (
          <Button
            variant="ghost"
            isDisabled={pending}
            isPending={archive.isPending}
            onPress={() => {
              archive.mutate(
                { practiceId, serviceId: service.id, data: { active: !service.active } },
                {
                  onSuccess: (saved) => {
                    const name = nameOf(saved.name);
                    onSaved(
                      saved.active
                        ? news('restoredNews', { service: name })
                        : news('archivedNews', { service: name }),
                    );
                  },
                },
              );
            }}
            className="me-auto"
          >
            {service.active ? (
              <Archive aria-hidden data-icon="inline-start" />
            ) : (
              <ArchiveRestore aria-hidden data-icon="inline-start" />
            )}
            {service.active ? t('archive') : t('restore')}
          </Button>
        )}
        <Button
          variant="outline"
          isDisabled={pending}
          onPress={onCancel}
          className={service === undefined ? 'ms-auto' : undefined}
        >
          {t('cancel')}
        </Button>
        <Button
          type="submit"
          isDisabled={archive.isPending}
          isPending={create.isPending || update.isPending}
        >
          {service === undefined ? t('create') : t('save')}
        </Button>
      </div>
      {service?.active === true ? (
        <p className="text-body-small text-text-secondary">{t('archiveHint')}</p>
      ) : null}
    </form>
  );
}

function ServiceDialog({
  service,
  list,
  onDone,
}: {
  readonly service?: ServiceDto;
  readonly list: ServiceListDto;
  readonly onDone: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.serviceForm');
  const page = useTranslations('dashboard.services');
  const [isOpen, setOpen] = useState(false);
  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={setOpen}>
      {service === undefined ? (
        <Button>
          <Plus aria-hidden data-icon="inline-start" />
          {page('add')}
        </Button>
      ) : (
        <Button variant="ghost">
          <Pencil aria-hidden data-icon="inline-start" />
          {page('edit')}
        </Button>
      )}
      <DialogContent title={service === undefined ? t('addTitle') : t('editTitle')} size="medium">
        {(close) => (
          <ServiceForm
            service={service}
            list={list}
            onCancel={close}
            onSaved={(news) => {
              close();
              onDone(news);
            }}
          />
        )}
      </DialogContent>
    </DialogTrigger>
  );
}

/** The online switch of a row (W12): only the admin changes it, and only for an offered service. */
function OnlineSwitch({
  service,
  onDone,
}: {
  readonly service: ServiceDto;
  readonly onDone: (news: string) => void;
}): ReactNode {
  const t = useTranslations('dashboard.services');
  const locale = useLocale();
  const { practiceId } = useDesk();
  const queryClient = useQueryClient();
  const update = useUpdateService({
    mutation: {
      onSettled: () =>
        queryClient.invalidateQueries({
          predicate: ({ queryKey }) => isPracticeQueryOf(practiceId, queryKey),
        }),
    },
  });
  return (
    <div className="flex flex-col gap-1">
      <Switch
        isSelected={service.isBookableOnline}
        isDisabled={!service.active || update.isPending}
        onChange={(online) => {
          update.mutate(
            { practiceId, serviceId: service.id, data: { isBookableOnline: online } },
            {
              onSuccess: (saved) => {
                onDone(
                  t('onlineNews', {
                    online: String(saved.isBookableOnline),
                    service: isolate(textIn(saved.name, locale)),
                  }),
                );
              },
            },
          );
        }}
      >
        {service.isBookableOnline ? t('onlineOn') : t('onlineOff')}
      </Switch>
      <FormError error={update.error} />
    </div>
  );
}

/** W12: the practice's services. Everyone of the team reads them; the admin changes them. */
export function ServicesPage(): ReactNode {
  const t = useTranslations('dashboard.services');
  const locale = useLocale();
  const { practiceId, role } = useDesk();
  const isAdmin = role === 'ADMIN';
  const list = useListServices(practiceId, { query: { retry: false } });
  const [news, setNews] = useState('');
  const newsRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (news !== '') newsRef.current?.focus();
  }, [news]);
  const data = list.data;
  const format = data === undefined ? undefined : practiceFormat(locale, data);
  // Archived services last: they only name old appointments.
  const services =
    data === undefined
      ? []
      : [
          ...data.services.filter(({ active }) => active),
          ...data.services.filter((s) => !s.active),
        ];
  const offered = services.filter(({ active }) => active);
  const doctorsOf = (service: ServiceDto): string =>
    new Intl.ListFormat(locale, { type: 'conjunction', style: 'narrow' }).format(
      service.providers.map(({ name }) => isolate(name)),
    );
  return (
    <>
      <header className="mb-6 flex flex-wrap items-end gap-4">
        <div className="me-auto min-w-0">
          <p className="text-body-default text-text-secondary">
            {data === undefined || format === undefined
              ? String.fromCodePoint(0xa0)
              : t('summary', {
                  count: offered.length,
                  online: format.number(offered.filter((s) => s.isBookableOnline).length),
                })}
          </p>
          <h1 className="text-heading-h1 text-text-primary">{t('title')}</h1>
        </div>
        {isAdmin && data !== undefined ? <ServiceDialog list={data} onDone={setNews} /> : null}
      </header>
      <p
        ref={newsRef}
        role="status"
        tabIndex={-1}
        className="mb-4 text-body-default text-text-success outline-none empty:hidden"
      >
        {news}
      </p>
      {isAdmin ? null : (
        <p className="mb-4 text-body-default text-text-secondary">{t('readOnly')}</p>
      )}
      <section
        aria-label={t('table')}
        className="overflow-x-auto rounded-lg border border-border-subtle bg-bg-surface"
      >
        {data === undefined || format === undefined ? (
          list.isError ? (
            <div className="p-4">
              <FormError error={list.error} />
            </div>
          ) : (
            <p role="status" className="p-4 text-body-default text-text-secondary">
              {t('loading')}
            </p>
          )
        ) : services.length === 0 ? (
          <p className="p-4 text-body-default text-text-secondary">{t('empty')}</p>
        ) : (
          <table className="w-full min-w-[48rem] text-start">
            <caption className="sr-only">{t('table')}</caption>
            <thead className="bg-bg-subtle">
              <tr>
                <th
                  scope="col"
                  className="px-5 py-3 text-start text-body-small text-text-secondary"
                >
                  {t('service')}
                </th>
                <th
                  scope="col"
                  className="px-5 py-3 text-start text-body-small text-text-secondary"
                >
                  {t('duration')}
                </th>
                <th
                  scope="col"
                  className="px-5 py-3 text-start text-body-small text-text-secondary"
                >
                  {t('doctors')}
                </th>
                <th
                  scope="col"
                  className="px-5 py-3 text-start text-body-small text-text-secondary"
                >
                  {t('online')}
                </th>
                {isAdmin ? (
                  <th
                    scope="col"
                    className="px-5 py-3 text-start text-body-small text-text-secondary"
                  >
                    <span className="sr-only">{t('actions')}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {services.map((service) => {
                const note = textIn(service.description, locale);
                return (
                  <tr key={service.id} className="border-t border-border-subtle align-middle">
                    <th scope="row" className="px-5 py-4 text-start font-normal">
                      <span className="flex flex-wrap items-center gap-2">
                        <span dir="auto" className="text-label-default text-text-primary">
                          {textIn(service.name, locale)}
                        </span>
                        {service.referralRequired ? (
                          <Badge variant="warning">{t('referral')}</Badge>
                        ) : null}
                        {service.active ? null : <Badge variant="neutral">{t('archived')}</Badge>}
                      </span>
                      {note === '' ? null : (
                        <span
                          dir="auto"
                          className="mt-1 line-clamp-1 block text-body-small text-text-secondary"
                        >
                          {note}
                        </span>
                      )}
                    </th>
                    <td className="px-5 py-4 text-body-default text-text-primary">
                      {t('minutes', { minutes: format.number(service.durationMinutes) })}
                    </td>
                    <td className="px-5 py-4 text-body-default text-text-primary">
                      {service.providers.length === 0 ? (
                        <span className="text-text-secondary">{t('noDoctors')}</span>
                      ) : (
                        doctorsOf(service)
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {isAdmin ? (
                        <OnlineSwitch service={service} onDone={setNews} />
                      ) : (
                        <span className="text-body-default text-text-primary">
                          {service.isBookableOnline ? t('onlineOn') : t('onlineOff')}
                        </span>
                      )}
                    </td>
                    {isAdmin ? (
                      <td className="px-5 py-4 text-end">
                        <ServiceDialog service={service} list={data} onDone={setNews} />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <Alert className="mt-6 flex gap-3 bg-bg-info-subtle">
        <Info aria-hidden className="size-5 shrink-0 text-icon-info" />
        <div>
          <AlertTitle>{t('textsTitle')}</AlertTitle>
          <AlertDescription>{t('textsBody')}</AlertDescription>
        </div>
      </Alert>
    </>
  );
}
